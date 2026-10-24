import type { ClientSession, Db } from "mongodb";
import { TOPICS, fechaDe, franjaDe, type EstadoEvent, type Mensaje, type PromesaEvent } from "@rutasur/shared";

type Clave = { fecha: string; zonaId: string; franja: string };

/** Incremento atómico sobre metricas_diarias (un documento por día + zona + franja). */
async function sumar(db: Db, session: ClientSession, clave: Clave, hubId: string, inc: Record<string, number>) {
  if (Object.keys(inc).length === 0) return;
  await db
    .collection("metricas_diarias")
    .updateOne(clave, { $inc: inc, $setOnInsert: { hubId } }, { upsert: true, session });
}

/**
 * Cumplimiento de SLA: cruza la promesa (envios.promesas) con la entrega (envios.estados).
 * Los dos eventos pueden llegar en cualquier orden: se guarda lo que llega y se cuenta
 * una sola vez cuando están los dos.
 */
async function unirSla(
  db: Db,
  session: ClientSession,
  shipmentId: string,
  campos: { venceEn?: Date; entregadoEn?: Date; hubId?: string; zonaId?: string },
) {
  const col = db.collection<{ _id: string; [k: string]: any }>("analitica_sla");
  const doc = await col.findOneAndUpdate(
    { _id: shipmentId },
    { $set: campos },
    { upsert: true, returnDocument: "after", session },
  );
  if (!doc?.venceEn || !doc.entregadoEn || doc.contado) return;

  const tarde = doc.entregadoEn > doc.venceEn;
  const iso = (doc.entregadoEn as Date).toISOString();
  await sumar(db, session, { fecha: fechaDe(iso), zonaId: doc.zonaId, franja: franjaDe(iso) }, doc.hubId, {
    [tarde ? "sla.tarde" : "sla.cumplidos"]: 1,
  });
  await col.updateOne({ _id: shipmentId }, { $set: { contado: true } }, { session });
}

export async function aplicar(db: Db, session: ClientSession, m: Mensaje): Promise<void> {
  if (m.topic === TOPICS.PROMESAS) {
    const ev = m.event as PromesaEvent;
    return unirSla(db, session, ev.shipmentId, { venceEn: new Date(ev.venceEn) });
  }

  const ev = m.event as EstadoEvent;
  if (ev.tipo !== "ENTREGADO" && ev.tipo !== "ENTREGA_FALLIDA") return;

  const clave: Clave = { fecha: fechaDe(ev.ocurridoEn), zonaId: ev.zonaId, franja: franjaDe(ev.ocurridoEn) };
  const inc: Record<string, number> = {};
  if (ev.intento === 1) {
    inc["primerIntento.total"] = 1;
    if (ev.tipo === "ENTREGADO") inc["primerIntento.entregados"] = 1;
  }
  if (ev.tipo === "ENTREGA_FALLIDA" && ev.motivo) inc[`motivos.${ev.motivo}`] = 1;
  await sumar(db, session, clave, ev.hubId, inc);

  if (ev.tipo === "ENTREGADO") {
    await unirSla(db, session, ev.shipmentId, {
      entregadoEn: new Date(ev.ocurridoEn),
      hubId: ev.hubId,
      zonaId: ev.zonaId,
    });
  }
}