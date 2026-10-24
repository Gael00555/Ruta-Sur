import {
  GRUPOS,
  TOPICS,
  alApagar,
  connectMongo,
  crearLogger,
  createKafka,
  createProducer,
  ensureIndexes,
  idDerivado,
  procesarUnaVez,
  publish,
  runConsumer,
  type EstadoEvent,
  type ReprogramacionEvent,
} from "@rutasur/shared";
import { decidir } from "./regla";

const log = crearLogger("reprogramacion");
const { client, db } = await connectMongo();
await ensureIndexes(db);

const kafka = createKafka("reprogramacion");
const producer = await createProducer(kafka);

const consumer = await runConsumer({
  kafka,
  servicio: "reprogramacion",
  groupId: GRUPOS.REPROGRAMACION,
  topics: [TOPICS.ESTADOS],
  dlqProducer: producer,
  handler: async (m) => {
    const ev = m.event as EstadoEvent;
    if (ev.tipo !== "ENTREGA_FALLIDA" || !ev.motivo) return;

    const d = decidir(ev);
    const salida: ReprogramacionEvent = {
      eventId: idDerivado(ev.eventId, "REPROG"),
      shipmentId: ev.shipmentId,
      tipo: d.tipo,
      ocurridoEn: ev.ocurridoEn,
      secuencia: ev.secuencia,
      hubId: ev.hubId,
      zonaId: ev.zonaId,
      repartidorId: ev.repartidorId,
      version: 1,
      intento: d.intento,
      motivo: ev.motivo,
      eventoOrigenId: ev.eventId,
      ...(d.nuevaFecha ? { nuevaFecha: d.nuevaFecha } : {}),
      ...(d.franja ? { franja: d.franja } : {}),
    };

    const nuevo = await procesarUnaVez(client, db, GRUPOS.REPROGRAMACION, ev.eventId, async () => {
      await publish(producer, TOPICS.REPROGRAMACIONES, salida);
    });
    if (nuevo) log.info("decisión", { shipmentId: ev.shipmentId, decision: d.tipo, intento: d.intento });
    else log.info("duplicado ignorado", { eventId: ev.eventId, partition: m.partition, offset: m.offset });
  },
});

log.info("reprogramacion listo");

alApagar(async () => {
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});