import { MongoClient, type ClientSession, type Db } from "mongodb";
import { config } from "./config";

export async function connectMongo(): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(config.mongoUri);
  await client.connect();
  return { client, db: client.db(config.mongoDb) };
}

/** Crea los índices del modelo de datos (idempotente). También crea las colecciones. */
export async function ensureIndexes(db: Db): Promise<void> {
  await db.collection("envios").createIndexes([
    { key: { shipmentId: 1 }, unique: true },
    { key: { estado: 1, zonaId: 1 } },
    { key: { "promesa.venceEn": 1 } },
  ]);
  await db.collection("alertas").createIndexes([{ key: { estado: 1, prioridad: 1 } }, { key: { shipmentId: 1 } }]);
  await db.collection("notificaciones").createIndex({ shipmentId: 1 });
  await db.collection("metricas_diarias").createIndex({ fecha: 1, zonaId: 1, franja: 1 }, { unique: true });
  await db.collection("eventos_procesados").createIndexes([
    { key: { consumidor: 1, eventId: 1 }, unique: true },
    { key: { creadoEn: 1 }, expireAfterSeconds: 7 * 24 * 3600 },
  ]);
}

/**
 * Idempotencia: aplica `efecto` y registra el eventId en UNA transacción
 * (el replica set de un nodo las permite). Devuelve false si ya estaba procesado.
 * `efecto` debe escribir solo en Mongo usando la sesión recibida.
 */
export async function procesarUnaVez(
  client: MongoClient,
  db: Db,
  consumidor: string,
  eventId: string,
  efecto: (session: ClientSession) => Promise<void>,
): Promise<boolean> {
  const session = client.startSession();
  try {
    let aplicado = false;
    await session.withTransaction(async () => {
      aplicado = false;
      const procesados = db.collection("eventos_procesados");
      if (await procesados.findOne({ consumidor, eventId }, { session })) return;
      await efecto(session);
      await procesados.insertOne({ consumidor, eventId, creadoEn: new Date() }, { session });
      aplicado = true;
    });
    return aplicado;
  } finally {
    await session.endSession();
  }
}
