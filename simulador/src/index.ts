import { createServer } from "node:http";
import { RelojSimulado, alApagar, crearLogger, createKafka, createProducer } from "@rutasur/shared";
import { ZONAS, params } from "./config";
import { planificar, type Item, type OpcionesPlan } from "./planificador";
import { crearRng } from "./rng";
import { HORA } from "./tiempo";

const log = crearLogger("simulador");
const reloj = new RelojSimulado(new Date(params.simInicio));
const producer = await createProducer(createKafka("simulador"));

let pendientes: Item[] = [];
let creados = 0;
let emitidos = 0;

function lanzar(shipmentId: string, creadoEn: number, extra: Partial<OpcionesPlan> = {}): string {
  const rng = crearRng(`${params.semilla}:${shipmentId}`);
  const zona = ZONAS[Math.floor(rng() * ZONAS.length)];
  pendientes.push(...planificar({ shipmentId, creadoEn, zona, rng, ...extra }));
  return shipmentId;
}

async function tick(): Promise<void> {
  const ahora = reloj.ahora().getTime();

  // flujo continuo: crea los envíos cuyo momento de creación ya llegó
  const cada = (60_000 / params.enviosPorMinuto) * params.aceleracion; // ms simulados entre envíos
  while (creados < params.maxEnvios && params.simInicio + creados * cada <= ahora) {
    const id = `ENV-${String(creados + 1).padStart(6, "0")}`;
    lanzar(id, params.simInicio + creados * cada, { ruido: true });
    creados++;
  }

  // emite lo que ya "ocurrió" en tiempo simulado
  const listos = pendientes.filter((i) => i.emitirEn <= ahora);
  if (listos.length === 0) return;
  pendientes = pendientes.filter((i) => i.emitirEn > ahora);
  listos.sort((a, b) => a.emitirEn - b.emitirEn);

  const porTopic = new Map<string, { key: string; value: string }[]>();
  for (const i of listos) {
    const lista = porTopic.get(i.topic) ?? [];
    lista.push({ key: i.clave, value: i.valor });
    porTopic.set(i.topic, lista);
  }
  try {
    await producer.sendBatch({
      acks: -1,
      topicMessages: [...porTopic].map(([topic, messages]) => ({ topic, messages })),
    });
    emitidos += listos.length;
  } catch (e) {
    pendientes = pendientes.concat(listos); // reintenta en el próximo tick
    throw e;
  }
}

// Escenarios a pedido (línea de tiempo compacta: 20 min simulados = 10 s reales)
function escenario(nombre: string): string {
  const ahora = reloj.ahora().getTime();
  const sufijo = Date.now().toString(36);
  switch (nombre) {
    case "feliz":
      return lanzar(`DEMO-FELIZ-${sufijo}`, ahora, { compacto: true, resultados: [null] });
    case "ausente":
      return lanzar(`DEMO-AUSENTE-${sufijo}`, ahora, { compacto: true, resultados: ["AUSENTE", null] });
    case "tercer-fallo":
      return lanzar(`DEMO-TERCER-${sufijo}`, ahora, {
        compacto: true,
        resultados: ["AUSENTE", "AUSENTE", "AUSENTE"],
      });
        case "demorado":
      // nació hace 8 h simuladas y está detenido en el hub; vence en 5 h
      return lanzar(`DEMO-DEMORADO-${sufijo}`, ahora - 8 * HORA, {
        compacto: true,
        detenerEnHub: true,
        venceEn: ahora + 5 * HORA,
      });
    case "malformado": {
      const id = `DEMO-MALFORMADO-${sufijo}`;
      producer
        .send({
          topic: "envios.estados",
          messages: [{ key: id, value: JSON.stringify({ eventId: `${id}-E1`, shipmentId: id, tipo: "VOLANDO" }) }],
        })
        .catch((e) => log.error("malformado falló", { error: String(e) }));
      return id;
    }
    case "rafaga":
      for (let i = 0; i < 500; i++) {
        lanzar(`RAF-${sufijo}-${i}`, ahora + i * 10 * params.aceleracion, { ruido: true }); // 1 cada 10 ms reales
      }
      return `500 envíos RAF-${sufijo}-0 a RAF-${sufijo}-499`;
    default:
      throw new Error(`escenario desconocido: ${nombre}`);
  }
}

const server = createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.setHeader("access-control-allow-origin", "*");
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "POST" && url.pathname.startsWith("/escenarios/")) {
      const nombre = url.pathname.split("/")[2];
      res.end(JSON.stringify({ ok: true, escenario: nombre, detalle: escenario(nombre) }));
    } else if (req.method === "GET" && url.pathname === "/estado") {
      res.end(JSON.stringify({ simulado: reloj.ahora().toISOString(), creados, emitidos, pendientes: pendientes.length }));
    } else {
      res.statusCode = 404;
      res.end(JSON.stringify({ ok: false, error: "no existe" }));
    }
  } catch (e) {
    res.statusCode = 400;
    res.end(JSON.stringify({ ok: false, error: String(e) }));
  }
});
server.listen(params.puerto, () =>
  log.info("simulador listo", { puerto: params.puerto, semilla: params.semilla, aceleracion: params.aceleracion }),
);

let activo = true;
(async () => {
  while (activo) {
    try {
      await tick();
    } catch (e) {
      log.error("tick falló", { error: String(e) });
    }
    await new Promise((r) => setTimeout(r, 100));
  }
})();

setInterval(() => log.info("estado", { simulado: reloj.ahora().toISOString(), creados, emitidos, pendientes: pendientes.length }), 10_000);

alApagar(async () => {
  activo = false;
  server.close();
  await producer.disconnect();
});

    