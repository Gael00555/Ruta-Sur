import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGO_URI ?? "mongodb://localhost:27018/?directConnection=true";
const dbName = process.env.MONGO_DB ?? "rutasur";

// una sola conexión compartida (sobrevive a los reinicios en caliente de desarrollo)
const g = globalThis as unknown as { _mongo?: Promise<MongoClient> };

export async function getDb(): Promise<Db> {
  g._mongo ??= new MongoClient(uri).connect().catch((e) => {
    g._mongo = undefined;
    throw e;
  });
  return (await g._mongo).db(dbName);
}