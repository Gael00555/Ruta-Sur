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
  type AlertaEvent,
  type EstadoEvent,
  type NotificacionEvent,
} from "@rutasur/shared";

const log = crearLogger("notificaciones");
const { client, db } = await connectMongo();
await ensureIndexes(db);

const kafka = createKafka("notificaciones");
const producer = await createProducer(kafka);

function armar(ev: EstadoEvent | AlertaEvent, origen: NotificacionEvent["origen"], mensaje: string): NotificacionEvent {
  return {
    eventId: idDerivado(ev.eventId, "NOTIF"), // determinista: un reintento publica el mismo id
    shipmentId: ev.shipmentId,
    tipo: "NOTIFICACION",
    ocurridoEn: ev.ocurridoEn,
    secuencia: ev.secuencia,
    hubId: ev.hubId,
    zonaId: ev.zonaId,
    repartidorId: ev.repartidorId,
    version: 1,
    origen,
    eventoOrigenId: ev.eventId,
    mensaje,
  };
}

const consumer = await runConsumer({
  kafka,
  servicio: "notificaciones",
  groupId: GRUPOS.NOTIFICACIONES,
  topics: [TOPICS.ESTADOS, TOPICS.ALERTAS],
  dlqProducer: producer,
  handler: async (m) => {
    let notif: NotificacionEvent;

    if (m.topic === TOPICS.ESTADOS) {
      const ev = m.event as EstadoEvent;
      if (ev.tipo !== "ENTREGA_FALLIDA") return;
      notif = armar(ev, "ENTREGA_FALLIDA", `No pudimos entregar tu envío ${ev.shipmentId} (${ev.motivo}). Podés reprogramar la entrega.`);
    } else {
      const ev = m.event as AlertaEvent;
      if (ev.tipo !== "ALERTA_ABIERTA") return;
      notif = armar(ev, "ALERTA_SLA", `Tu envío ${ev.shipmentId} podría llegar con demora. Estamos trabajando para resolverlo.`);
    }

    // el evento de origen se registra como procesado: un duplicado no genera otro aviso
    const nuevo = await procesarUnaVez(client, db, GRUPOS.NOTIFICACIONES, m.event.eventId, async () => {
      await publish(producer, TOPICS.NOTIFICACIONES, notif);
    });
    if (!nuevo) log.info("duplicado ignorado", { eventId: m.event.eventId, partition: m.partition, offset: m.offset });
  },
});

log.info("notificaciones listo");

alApagar(async () => {
  await consumer.disconnect();
  await producer.disconnect();
  await client.close();
});