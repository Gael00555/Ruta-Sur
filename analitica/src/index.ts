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

const log = crearLogger("analitica");
const { client, db } = await connectMongo();
await ensureIndexes(db);

const kafka = createKafka("analitica");
const dlqProducer = await createProducer(kafka);

const consumer = await runConsumer({
  kafka,
  servicio: "analitica",
  groupId: GRUPOS.ANALITICA,
  topics: [TOPICS.ESTADOS, TOPICS.PROMESAS],
  dlqProducer,
  handler: async (m) => {
    const nuevo = await procesarUnaVez(client, db, GRUPOS.ANALITICA, m.event.eventId, (session) =>
      aplicar(db, session, m),
    );
    if (!nuevo) log.info("duplicado ignorado", { eventId: m.event.eventId, partition: m.partition, offset: m.offset });
  },
});

log.info("analitica listo");

alApagar(async () => {
  await consumer.disconnect();
  await dlqProducer.disconnect();
  await client.close();
});