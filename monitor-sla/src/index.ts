import {
  GRUPOS,
  TOPICS,
  alApagar,
  config,
  connectMongo,
  crearLogger,
  createKafka,
  createProducer,
  idDerivado,
  publish,
  runConsumer,
  type AlertaEvent,
  type EstadoEvent,
  type PromesaEvent,
} from "@rutasur/shared";
import { PRIORIDAD, evaluarReglas, type Accion, type Seguimiento } from "./reglas";

const log = crearLogger("monitor-sla");
const { client, db } = await connectMongo();
const col = db.collection<Seguimiento>("monitor_estado");
const meta = db.collection<{ _id: string; valor: Record<string, number> }>("monitor_meta");

// --- Estado: en memoria, respaldado en MongoDB ---
const seguimientos = new Map<string, Seguimiento>();
for (const s of await col.find().toArray()) seguimientos.set(s._id, s);

// Reloj simulado = el que viaja en los eventos. Una marca por partición (máximo ocurridoEn visto);
// "ahora" es la menor: así una partición adelantada no hace correr el tiempo de las demás.
const marcas = new Map<number, number>();
const guardadas = (await meta.findOne({ _id: "marcas" }))?.valor ?? {};
for (const [p, v] of Object.entries(guardadas)) marcas.set(Number(p), v);
const reloj = () => (marcas.size ? Math.min(...marcas.values()) : 0);

log.info("estado recuperado", { envios: seguimientos.size, simulado: reloj() ? new Date(reloj()).toISOString() : null });

const ASENTAR_MS = 300; // no evaluar un envío que acaba de recibir eventos (ráfagas con estados intermedios)
const tocado = new Map<string, number>();

// El manejador de eventos y la evaluación periódica nunca corren a la vez
let cola: Promise<unknown> = Promise.resolve();
function serializar<T>(fn: () => Promise<T>): Promise<T> {
  const r = cola.then(() => fn());
  cola = r.catch(() => undefined);
  return r;
}

const guardar = (s: Seguimiento) => col.replaceOne({ _id: s._id }, s, { upsert: true });

function obtener(b: { shipmentId: string; hubId: string; zonaId: string; repartidorId: string | null }): Seguimiento {
  let s = seguimientos.get(b.shipmentId);
  if (!s) {
    s = {
      _id: b.shipmentId,
      hubId: b.hubId,
      zonaId: b.zonaId,
      repartidorId: b.repartidorId,
      estado: null,
      ultimaSecuencia: 0,
      venceEn: null,
      ultimoFalloEn: null,
      alertadas: [],
      cerradas: [],
    };
    seguimientos.set(s._id, s);
  }
  return s;
}

function crearEvento(s: Seguimiento, a: Accion, ahora: number): AlertaEvent {
  return {
    // determinista: si se reintenta tras un fallo, sale el mismo eventId y el proyector lo descarta
    eventId: idDerivado(s._id, `${a.tipo === "ALERTA_ABIERTA" ? "ABRE" : "CIERRA"}:${a.regla}`),
    shipmentId: s._id,
    tipo: a.tipo,
    ocurridoEn: new Date(ahora).toISOString(),
    secuencia: s.ultimaSecuencia,
    hubId: s.hubId,
    zonaId: s.zonaId,
    repartidorId: s.repartidorId,
    version: 1,
    regla: a.regla,
    prioridad: PRIORIDAD[a.regla],
    causa: a.causa,
  };
}

const kafka = createKafka("monitor-sla");
const producer = await createProducer(kafka);

// --- Cruce de los dos streams: solo actualiza el estado; las alertas las emite la evaluación ---
const consumer = await runConsumer({
  kafka,
  servicio: "monitor-sla",
  groupId: GRUPOS.MONITOR_SLA,
  topics: [TOPICS.ESTADOS, TOPICS.PROMESAS],
  dlqProducer: producer,
  handler: (m) =>
    serializar(async () => {
      const t = Date.parse(m.event.ocurridoEn);
      marcas.set(m.partition, Math.max(marcas.get(m.partition) ?? 0, t));

      const s = obtener(m.event);
      let cambio = false;

      if (m.topic === TOPICS.PROMESAS) {
        const venceEn = Date.parse((m.event as PromesaEvent).venceEn);
        if (s.venceEn !== venceEn) {
          s.venceEn = venceEn;
          cambio = true;
        }
      } else {
        const ev = m.event as EstadoEvent;
        // regla de orden: un duplicado o un evento viejo no cambia nada
        if (ev.secuencia > s.ultimaSecuencia) {
          s.estado = ev.tipo;
          s.ultimaSecuencia = ev.secuencia;
          s.repartidorId = ev.repartidorId;
          s.hubId = ev.hubId;
          s.zonaId = ev.zonaId;
          if (ev.tipo === "ENTREGA_FALLIDA") s.ultimoFalloEn = t;
          cambio = true;
        }
      }

      if (cambio) {
        tocado.set(s._id, Date.now());
        await guardar(s);
      }
    }),
});

// --- Evaluación: cada minuto SIMULADO (con aceleración 120 = cada 0,5 s reales) ---
async function evaluar(): Promise<void> {
  const ahora = reloj();
  if (!ahora) return;

  const lote: { s: Seguimiento; a: Accion }[] = [];
  for (const s of seguimientos.values()) {
    if (Date.now() - (tocado.get(s._id) ?? 0) < ASENTAR_MS) continue;
    for (const a of evaluarReglas(s, ahora)) lote.push({ s, a });
  }
  if (lote.length === 0) return;

  // primero se publica y después se anota: si se cae en el medio, al reiniciar se reevalúa
  // y se publica lo mismo (mismo eventId): no se pierde nada y el proyector no duplica
  await publish(producer, TOPICS.ALERTAS, lote.map(({ s, a }) => crearEvento(s, a, ahora)));

  const sucios = new Set<Seguimiento>();
  for (const { s, a } of lote) {
    (a.tipo === "ALERTA_ABIERTA" ? s.alertadas : s.cerradas).push(a.regla);
    sucios.add(s);
    log.info(a.tipo === "ALERTA_ABIERTA" ? "alerta abierta" : "alerta cerrada", {
      shipmentId: s._id,
      regla: a.regla,
      prioridad: PRIORIDAD[a.regla],
      simulado: new Date(ahora).toISOString(),
    });
  }
  for (const s of sucios) await guardar(s);
}

let activo = true;
const periodoMs = Math.max(200, 60_000 / config.aceleracion);
(async () => {
  while (activo) {
    try {
      await serializar(evaluar);
    } catch (e) {
      log.error("evaluación falló", { error: String(e) });
    }
    await new Promise((r) => setTimeout(r, periodoMs));
  }
})();

// la marca de tiempo también se respalda: tras un reinicio el reloj no retrocede
const respaldo = setInterval(() => {
  if (marcas.size) {
    meta.updateOne({ _id: "marcas" }, { $set: { valor: Object.fromEntries(marcas) } }, { upsert: true }).catch(() => undefined);
  }
}, 2000);

log.info("monitor-sla listo", { periodoEvaluacionMs: periodoMs });

alApagar(async () => {
  activo = false;
  clearInterval(respaldo);
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});