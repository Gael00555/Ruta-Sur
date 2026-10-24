import {
  GRUPOS,
  TOPICS,
  alApagar,
  connectMongo,
  crearLogger,
  createKafka,
  createProducer,
  ensureIndexes,
  procesarUnaVez,
  runConsumer,
} from "@rutasur/shared";
import { aplicar } from "./aplicar";

const log = crearLogger("proyector");
const { client, db } = await connectMongo();
await ensureIndexes(db);

const kafka = createKafka("proyector");
const dlqProducer = await createProducer(kafka);

const consumer = await runConsumer({
  kafka,
  servicio: "proyector",
  groupId: GRUPOS.PROYECTOR,
  topics: [TOPICS.ESTADOS, TOPICS.PROMESAS, TOPICS.REPROGRAMACIONES, TOPICS.ALERTAS, TOPICS.NOTIFICACIONES],
  dlqProducer,
  handler: async (m) => {
    const aplicado = await procesarUnaVez(client, db, GRUPOS.PROYECTOR, m.event.eventId, (session) =>
      aplicar(db, session, m, log),
    );
    if (!aplicado) {
      log.info("duplicado ignorado", { eventId: m.event.eventId, partition: m.partition, offset: m.offset });
    }
  },
});

log.info("proyector listo");

alApagar(async () => {
  await consumer.disconnect();
  await dlqProducer.disconnect();
  await client.close();
});