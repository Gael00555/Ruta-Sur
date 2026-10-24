import { execFileSync } from "node:child_process";
import { GRUPOS, TOPICS, connectMongo } from "../src/index";

// 1) rebobinar los offsets del grupo (falla si el proyector sigue corriendo: el grupo debe estar inactivo)
const topics = [TOPICS.ESTADOS, TOPICS.PROMESAS, TOPICS.REPROGRAMACIONES, TOPICS.ALERTAS, TOPICS.NOTIFICACIONES];
execFileSync(
  "docker",
  [
    "exec", "rutasur-kafka", "/opt/kafka/bin/kafka-consumer-groups.sh",
    "--bootstrap-server", "localhost:9092",
    "--group", GRUPOS.PROYECTOR,
    ...topics.flatMap((t) => ["--topic", t]),
    "--reset-offsets", "--to-earliest", "--execute",
  ],
  { stdio: "inherit" },
);

// 2) borrar las vistas que escribe el proyector y sus registros de idempotencia
const { client, db } = await connectMongo();
for (const c of ["envios", "alertas", "notificaciones"]) {
  const r = await db.collection(c).deleteMany({});
  console.log(`${c}: ${r.deletedCount} documentos borrados`);
}
const r = await db.collection("eventos_procesados").deleteMany({ consumidor: GRUPOS.PROYECTOR });
console.log(`eventos_procesados (proyector): ${r.deletedCount} borrados`);
await client.close();

console.log("\nListo. Levantá el proyector: reconstruye todo leyendo Kafka desde el inicio.");