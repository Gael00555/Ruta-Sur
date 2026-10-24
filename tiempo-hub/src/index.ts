import type { ClientSession } from "mongodb";
import {
  TOPICS,
  alApagar,
  connectMongo,
  crearLogger,
  createKafka,
  createProducer,
  ensureIndexes,
  fechaDe,
  franjaDe,
  procesarUnaVez,
  runConsumer,
  type EstadoEvent,
} from "@rutasur/shared";

// Grupo NUEVO: no tiene offsets guardados, así que lee envios.estados desde el principio
// y completa el histórico sin tocar a los demás servicios.
const GRUPO = "analitica-tiempo-hub";
const log = crearLogger("tiempo-hub");
const { client, db } = await connectMongo();
await ensureIndexes(db);

const kafka = createKafka("tiempo-hub");
const dlqProducer = await createProducer(kafka);

/** Cruza INGRESADO_HUB con el primer EN_REPARTO de cada envío; llegan en orden, pero se tolera cualquier orden. */
async function unir(session: ClientSession, ev: EstadoEvent): Promise<void> {
  const col = db.collection<{ _id: string; [k: string]: any }>("analitica_tiempo_hub");
  const campos =
    ev.tipo === "INGRESADO_HUB"
      ? { ingresoEn: new Date(ev.ocurridoEn) }
      : { salidaEn: new Date(ev.ocurridoEn), hubId: ev.hubId, zonaId: ev.zonaId };

  const doc = await col.findOneAndUpdate(
    { _id: ev.shipmentId },
    { $set: campos },
    { upsert: true, returnDocument: "after", session },
  );
  if (!doc?.ingresoEn || !doc.salidaEn || doc.contado) return;

  const minutos = (doc.salidaEn.getTime() - doc.ingresoEn.getTime()) / 60_000;
  const iso = (doc.salidaEn as Date).toISOString();
  await db.collection("metricas_diarias").updateOne(
    { fecha: fechaDe(iso), zonaId: doc.zonaId, franja: franjaDe(iso) },
    { $inc: { "tiempoHub.sumaMin": minutos, "tiempoHub.n": 1 }, $setOnInsert: { hubId: doc.hubId } },
    { upsert: true, session },
  );
  await col.updateOne({ _id: ev.shipmentId }, { $set: { contado: true } }, { session });
}

const consumer = await runConsumer({
  kafka,
  servicio: "tiempo-hub",
  groupId: GRUPO,
  topics: [TOPICS.ESTADOS],
  dlqProducer,
  fromBeginning: true,
  handler: async (m) => {
    const ev = m.event as EstadoEvent;
    // solo el primer intento: el reintento no vuelve a pasar por el hub
    if (ev.tipo !== "INGRESADO_HUB" && !(ev.tipo === "EN_REPARTO" && ev.intento === 1)) return;
    const nuevo = await procesarUnaVez(client, db, GRUPO, ev.eventId, (session) => unir(session, ev));
    if (!nuevo) log.info("duplicado ignorado", { eventId: ev.eventId, partition: m.partition, offset: m.offset });
  },
});

log.info("tiempo-hub listo: leyendo envios.estados desde el inicio");

alApagar(async () => {
  await consumer.disconnect();
  await dlqProducer.disconnect();
  await client.close();
});