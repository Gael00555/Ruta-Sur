import { getDb } from "./db";
import type { AlertaDoc, AnaliticaData, DetalleData, EnvioDoc, NotifDoc, TorreData, TrackingData } from "./tipos";
import { RANGO, plain } from "./util";

export async function torre(): Promise<TorreData> {
  const db = await getDb();
  const grupos = await db
    .collection("envios")
    .aggregate<{ _id: string | null; n: number }>([{ $group: { _id: "$estado", n: { $sum: 1 } } }])
    .toArray();
  const contadores: Record<string, number> = {};
  let total = 0;
  for (const g of grupos) {
    if (!g._id) continue;
    contadores[g._id] = g.n;
    total += g.n;
  }

  const alertas = plain<AlertaDoc[]>(
    await db.collection("alertas").find({ estado: "ABIERTA" }).sort({ abiertaEn: -1 }).limit(200).toArray(),
  );
  alertas.sort((a, b) => (RANGO[a.prioridad] ?? 9) - (RANGO[b.prioridad] ?? 9)); // estable: dentro de cada prioridad, la más reciente primero

  const ultimos = plain<TorreData["ultimos"]>(
    await db
      .collection("envios")
      .find({ estado: { $exists: true } }, { projection: { _id: 0, shipmentId: 1, estado: 1, zonaId: 1, actualizadoEn: 1 } })
      .sort({ actualizadoEn: -1 })
      .limit(12)
      .toArray(),
  );

  return { contadores, total, alertas: alertas.slice(0, 30), ultimos };
}

export async function detalleEnvio(id: string): Promise<DetalleData | null> {
  const db = await getDb();
  const envio = await db.collection("envios").findOne({ shipmentId: id }, { projection: { _id: 0 } });
  if (!envio) return null;
  const [alertas, notificaciones] = await Promise.all([
    db.collection("alertas").find({ shipmentId: id }).sort({ abiertaEn: 1 }).toArray(),
    db.collection("notificaciones").find({ shipmentId: id }).sort({ ocurridoEn: 1 }).toArray(),
  ]);
  return {
    envio: plain<EnvioDoc>(envio),
    alertas: plain<AlertaDoc[]>(alertas),
    notificaciones: plain<NotifDoc[]>(notificaciones),
  };
}

const TEXTO: Record<string, [string, string]> = {
  CREADO: ["Recibimos tu pedido", "El comercio registró tu envío."],
  INGRESADO_HUB: ["En nuestro centro de distribución", "Tu paquete llegó y lo estamos preparando."],
  CLASIFICADO: ["Listo para salir", "Tu paquete ya tiene repartidor asignado."],
  EN_REPARTO: ["En camino", "Tu paquete salió a reparto."],
  ENTREGADO: ["Entregado", "¡Tu paquete fue entregado!"],
};
const PASOS = ["CREADO", "INGRESADO_HUB", "CLASIFICADO", "EN_REPARTO", "ENTREGADO"];

/** Vista pública: solo estado y fecha estimada. Sin hub, zona, repartidor, alertas ni motivos internos. */
export async function trackingPublico(id: string): Promise<TrackingData | null> {
  const db = await getDb();
  const raw = await db.collection("envios").findOne({ shipmentId: id });
  if (!raw) return null;
  const e = plain<EnvioDoc>(raw);
  if (!e.estado) return null;

  // la reprogramación guardada corresponde al fallo actual si es posterior (o igual) a la última actualización
  const r = e.reprogramacion;
  const vigente = r && r.decididaEn >= (e.actualizadoEn ?? "") ? r : null;

  let [titulo, detalle] = TEXTO[e.estado] ?? ["En proceso", "Estamos procesando tu envío."];
  if (e.estado === "ENTREGA_FALLIDA") {
    if (vigente?.tipo === "RETENIDO") {
      titulo = "Necesitamos corregir tu dirección";
      detalle = "Tu envío está retenido hasta que la dirección se corrija.";
    } else if (vigente?.tipo === "DEVOLUCION") {
      titulo = "Tu envío vuelve al comercio";
      detalle = "No pudimos entregarlo y será devuelto al remitente.";
    } else {
      titulo = "No pudimos entregarlo";
      detalle = vigente ? "Programamos un nuevo intento." : "Estamos definiendo un nuevo intento.";
    }
  }

  let estimado: string | null = null;
  const terminal = e.estado === "ENTREGADO" || vigente?.tipo === "RETENIDO" || vigente?.tipo === "DEVOLUCION";
  if (!terminal) {
    if (r?.tipo === "REPROGRAMADO" && r.nuevaFecha && (vigente || r.intento === e.intento)) {
      estimado = `${r.nuevaFecha} (${r.franja === "MANANA" ? "mañana" : "tarde"})`;
    } else if (e.promesa) {
      estimado = e.promesa.venceEn.slice(0, 10);
    }
  }

  return {
    shipmentId: id,
    titulo,
    detalle,
    paso: e.estado === "ENTREGA_FALLIDA" ? 3 : PASOS.indexOf(e.estado),
    estimado,
  };
}

export interface Filtros {
  zona?: string;
  hub?: string;
  fecha?: string;
}

/** Los indicadores salen de agregaciones sobre metricas_diarias (ya precalculada por el servicio de analítica). */
export async function analitica(f: Filtros): Promise<AnaliticaData> {
  const db = await getDb();
  const col = db.collection("metricas_diarias");
  const match: Record<string, string> = {};
  if (f.zona) match.zonaId = f.zona;
  if (f.hub) match.hubId = f.hub;
  if (f.fecha) match.fecha = f.fecha;

  const pi = { total: { $sum: "$primerIntento.total" }, entregados: { $sum: "$primerIntento.entregados" } };

  const [zonaFranja, porDia, motivos, sla, tiempos, zonas, hubs, fechas] = await Promise.all([
    col.aggregate([{ $match: match }, { $group: { _id: { zonaId: "$zonaId", franja: "$franja" }, ...pi } }]).toArray(),
    col.aggregate([{ $match: match }, { $group: { _id: "$fecha", ...pi } }, { $sort: { _id: 1 } }]).toArray(),
    col
      .aggregate([
        { $match: match },
        {
          $group: {
            _id: "$zonaId",
            AUSENTE: { $sum: "$motivos.AUSENTE" },
            DIRECCION_INCORRECTA: { $sum: "$motivos.DIRECCION_INCORRECTA" },
            RECHAZADO: { $sum: "$motivos.RECHAZADO" },
            ZONA_INACCESIBLE: { $sum: "$motivos.ZONA_INACCESIBLE" },
          },
        },
        { $sort: { _id: 1 } },
      ])
      .toArray(),
    col
      .aggregate([
        { $match: match },
        { $group: { _id: { hubId: "$hubId", fecha: "$fecha" }, cumplidos: { $sum: "$sla.cumplidos" }, tarde: { $sum: "$sla.tarde" } } },
        { $sort: { "_id.fecha": 1, "_id.hubId": 1 } },
      ])
      .toArray(),
    // cuarto indicador (paso 8): vacío hasta que se active el reprocesamiento
    col
      .aggregate([
        { $match: match },
        { $group: { _id: { hubId: "$hubId", fecha: "$fecha" }, sumaMin: { $sum: "$tiempoHub.sumaMin" }, n: { $sum: "$tiempoHub.n" } } },
        { $sort: { "_id.fecha": 1, "_id.hubId": 1 } },
      ])
      .toArray(),
    col.distinct("zonaId"),
    col.distinct("hubId"),
    col.distinct("fecha"),
  ]);

  return {
    filtros: { zonas: zonas.sort(), hubs: hubs.sort(), fechas: fechas.sort() },
    zonaFranja: zonaFranja.map((r) => ({ zonaId: r._id.zonaId, franja: r._id.franja, total: r.total, entregados: r.entregados })),
    porDia: porDia.map((r) => ({ fecha: r._id, total: r.total, entregados: r.entregados })),
    motivos: motivos.map((r) => ({
      zonaId: r._id,
      AUSENTE: r.AUSENTE,
      DIRECCION_INCORRECTA: r.DIRECCION_INCORRECTA,
      RECHAZADO: r.RECHAZADO,
      ZONA_INACCESIBLE: r.ZONA_INACCESIBLE,
    })),
    sla: sla.map((r) => ({ hubId: r._id.hubId, fecha: r._id.fecha, cumplidos: r.cumplidos, tarde: r.tarde })),
    tiempos: tiempos
      .filter((r) => r.n > 0)
      .map((r) => ({ hubId: r._id.hubId, fecha: r._id.fecha, minutos: Math.round((10 * r.sumaMin) / r.n) / 10 })),
  };
}