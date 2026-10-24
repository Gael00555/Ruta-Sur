import { TOPICS, parseEvent, createKafka, connectMongo, ensureIndexes, procesarUnaVez } from "../src/index";

const ok = (c: boolean, msg: string) => {
  console.log(`${c ? "✔" : "✘"} ${msg}`);
  if (!c) process.exitCode = 1;
};

// 1. Validación de esquema
const valido = {
  eventId: "e1", shipmentId: "S1", tipo: "CREADO", ocurridoEn: "2026-03-02T09:00:00.000Z",
  secuencia: 1, hubId: "HUB1", zonaId: "Z1", repartidorId: null, intento: 1, version: 1,
};
ok(parseEvent(TOPICS.ESTADOS, JSON.stringify(valido)).ok, "evento válido pasa el esquema");
ok(!parseEvent(TOPICS.ESTADOS, JSON.stringify({ ...valido, tipo: "ENTREGA_FALLIDA" })).ok, "ENTREGA_FALLIDA sin motivo se rechaza");
ok(!parseEvent(TOPICS.ESTADOS, "{no es json").ok, "JSON roto se rechaza");

// 2. Kafka: existen los 6 topics
const admin = createKafka("smoke").admin();
await admin.connect();
const topics = await admin.listTopics();
await admin.disconnect();
ok(Object.values(TOPICS).every((t) => topics.includes(t)), "los 6 topics existen en Kafka");

// 3. Mongo: índices + idempotencia transaccional
const { client, db } = await connectMongo();
await ensureIndexes(db);
const id = `smoke-${Date.now()}`;
let n = 0;
const a = await procesarUnaVez(client, db, "smoke", id, async () => { n++; });
const b = await procesarUnaVez(client, db, "smoke", id, async () => { n++; });
ok(a && !b && n === 1, "idempotencia: el mismo eventId se aplica una sola vez");
await db.collection("eventos_procesados").deleteMany({ consumidor: "smoke" });
await client.close();
