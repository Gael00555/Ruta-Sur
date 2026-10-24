import { TOPICS, connectMongo, createKafka } from "../src/index";

async function kafkaListo(): Promise<boolean> {
  const admin = createKafka("esperar").admin();
  try {
    await admin.connect();
    const topics = await admin.listTopics();
    return Object.values(TOPICS).every((t) => topics.includes(t));
  } catch {
    return false;
  } finally {
    await admin.disconnect().catch(() => undefined);
  }
}

async function mongoListo(): Promise<boolean> {
  try {
    const { client, db } = await connectMongo();
    try {
      const r = await db.admin().command({ hello: 1 });
      return !!r.isWritablePrimary;
    } finally {
      await client.close();
    }
  } catch {
    return false;
  }
}

const limite = Date.now() + 180_000;
process.stdout.write("Esperando Kafka (con los 6 topics) y MongoDB (replica set)");
while (Date.now() < limite) {
  const [k, m] = await Promise.all([kafkaListo(), mongoListo()]);
  if (k && m) {
    console.log("\n✔ entorno listo");
    process.exit(0);
  }
  process.stdout.write(".");
  await new Promise((r) => setTimeout(r, 2000));
}
console.error("\n✘ el entorno no quedó listo en 3 minutos. Revisá: docker ps -a");
process.exit(1);