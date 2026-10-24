import { createHash } from "node:crypto";
import { connectMongo } from "../src/index";

// serializa con las claves ordenadas: el hash no depende del orden de inserción
const canon = (x: unknown): unknown =>
  Array.isArray(x)
    ? x.map(canon)
    : x instanceof Date
      ? x.toISOString()
      : x && typeof x === "object"
        ? Object.fromEntries(
            Object.entries(x)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, v]) => [k, canon(v)]),
          )
        : x;

const { client, db } = await connectMongo();
const docs = await db.collection("envios").find({}, { projection: { _id: 0 } }).sort({ shipmentId: 1 }).toArray();
for (const d of docs) {
  d.historial = (d.historial ?? []).sort(
    (a: any, b: any) => a.ocurridoEn - b.ocurridoEn || (a.eventId < b.eventId ? -1 : 1),
  );
}
const huella = createHash("sha1").update(JSON.stringify(canon(docs))).digest("hex").slice(0, 12);
console.log(`envios: ${docs.length} documentos · huella ${huella}`);
await client.close();