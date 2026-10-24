import type { ClientSession, Db } from "mongodb";
import {
  TOPICS,
  type AlertaEvent,
  type EstadoEvent,
  type Logger,
  type Mensaje,
  type NotificacionEvent,
  type PromesaEvent,
  type ReprogramacionEvent,
} from "@rutasur/shared";

// colecciones sin esquema tipado: este servicio escribe documentos con forma libre
interface ColSuelta {
  findOne(filtro: any, opts?: any): Promise<any>;
  updateOne(filtro: any, cambios: any, opts?: any): Promise<unknown>;
}
const col = (db: Db, nombre: string) => db.collection(nombre) as unknown as ColSuelta;
/** Traduce cada evento a su escritura en MongoDB (todas dentro de la transacción de idempotencia). */
export async function aplicar(db: Db, session: ClientSession, m: Mensaje, log: Logger): Promise<void> {
  switch (m.topic) {
    case TOPICS.ESTADOS:
      return estado(db, session, m.event as EstadoEvent, log);
    case TOPICS.PROMESAS:
      return promesa(db, session, m.event as PromesaEvent);
    case TOPICS.REPROGRAMACIONES:
      return reprogramacion(db, session, m.event as ReprogramacionEvent);
    case TOPICS.ALERTAS:
      return alerta(db, session, m.event as AlertaEvent);
    case TOPICS.NOTIFICACIONES:
      return notificacion(db, session, m.event as NotificacionEvent);
  }
}

async function estado(db: Db, session: ClientSession, ev: EstadoEvent, log: Logger): Promise<void> {
  const envios = col(db, "envios");
  const actual = await envios.findOne({ shipmentId: ev.shipmentId }, { session, projection: { ultimaSecuencia: 1 } });

  // regla de orden: secuencia menor o igual a la ya aplicada -> se descarta
  if (actual && ev.secuencia <= (actual.ultimaSecuencia ?? 0)) {
    log.warn("evento fuera de orden descartado", {
      eventId: ev.eventId,
      shipmentId: ev.shipmentId,
      secuencia: ev.secuencia,
      aplicada: actual.ultimaSecuencia,
    });
    return;
  }

  const ocurridoEn = new Date(ev.ocurridoEn);
  await envios.updateOne(
    { shipmentId: ev.shipmentId },
    {
      $set: {
        estado: ev.tipo,
        hubId: ev.hubId,
        zonaId: ev.zonaId,
        repartidorId: ev.repartidorId,
        intento: ev.intento,
        ultimaSecuencia: ev.secuencia,
        actualizadoEn: ocurridoEn,
        ...(ev.motivo ? { ultimoMotivo: ev.motivo } : {}),
      },
      $push: {
        historial: {
          eventId: ev.eventId,
          tipo: ev.tipo,
          ocurridoEn,
          secuencia: ev.secuencia,
          intento: ev.intento,
          ...(ev.motivo ? { motivo: ev.motivo } : {}),
        },
      },
       $min: { creadoEn: ocurridoEn },
    },
    { upsert: true, session },
  );
}

async function promesa(db: Db, session: ClientSession, ev: PromesaEvent): Promise<void> {
  await col(db, "envios").updateOne(
    { shipmentId: ev.shipmentId },
    {
      $set: { promesa: { venceEn: new Date(ev.venceEn) } },
      $min: { creadoEn: new Date(ev.ocurridoEn) },
      $setOnInsert: { hubId: ev.hubId, zonaId: ev.zonaId, ultimaSecuencia: 0 },
    },
    { upsert: true, session },
  );
}

async function reprogramacion(db: Db, session: ClientSession, ev: ReprogramacionEvent): Promise<void> {
  const ocurridoEn = new Date(ev.ocurridoEn);
  await col(db, "envios").updateOne(
    { shipmentId: ev.shipmentId },
    {
      $set: {
        reprogramacion: {
          tipo: ev.tipo,
          intento: ev.intento,
          motivo: ev.motivo,
          nuevaFecha: ev.nuevaFecha ?? null,
          franja: ev.franja ?? null,
          decididaEn: ocurridoEn,
        },
      },
      $push: {
        historial: {
          eventId: ev.eventId,
          tipo: ev.tipo,
          ocurridoEn,
          intento: ev.intento,
          motivo: ev.motivo,
          ...(ev.nuevaFecha ? { nuevaFecha: ev.nuevaFecha } : {}),
          ...(ev.franja ? { franja: ev.franja } : {}),
        },
      },
       $min: { creadoEn: ocurridoEn },
    },
    { upsert: true, session },
  );
}

async function alerta(db: Db, session: ClientSession, ev: AlertaEvent): Promise<void> {
  const alertas = col(db, "alertas");
  const _id = `${ev.shipmentId}:${ev.regla}`; // una alerta por regla y envío

  if (ev.tipo === "ALERTA_ABIERTA") {
    // $setOnInsert: una alerta ya existente (o cerrada) nunca se reabre ni se pisa
    await alertas.updateOne(
      { _id },
      {
        $setOnInsert: {
          shipmentId: ev.shipmentId,
          regla: ev.regla,
          prioridad: ev.prioridad,
          causa: ev.causa,
          estado: "ABIERTA",
          hubId: ev.hubId,
          zonaId: ev.zonaId,
          abiertaEn: new Date(ev.ocurridoEn),
        },
      },
      { upsert: true, session },
    );
  } else {
    await alertas.updateOne({ _id }, { $set: { estado: "CERRADA", cerradaEn: new Date(ev.ocurridoEn) } }, { session });
  }
}

async function notificacion(db: Db, session: ClientSession, ev: NotificacionEvent): Promise<void> {
  await col(db, "notificaciones").updateOne(
    { _id: ev.eventId },
    {
      $setOnInsert: {
        shipmentId: ev.shipmentId,
        origen: ev.origen,
        eventoOrigenId: ev.eventoOrigenId,
        mensaje: ev.mensaje,
        canal: "SIMULADO",
        ocurridoEn: new Date(ev.ocurridoEn),
      },
    },
    { upsert: true, session },
  );
}