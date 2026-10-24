export interface HistorialItem {
  eventId: string;
  tipo: string;
  ocurridoEn: string;
  secuencia?: number;
  intento?: number;
  motivo?: string;
  nuevaFecha?: string;
  franja?: string;
}

export interface EnvioDoc {
  shipmentId: string;
  estado?: string;
  hubId?: string;
  zonaId?: string;
  repartidorId?: string | null;
  intento?: number;
  promesa?: { venceEn: string };
  reprogramacion?: {
    tipo: string;
    intento: number;
    motivo: string;
    nuevaFecha: string | null;
    franja: string | null;
    decididaEn: string;
  };
  historial?: HistorialItem[];
  actualizadoEn?: string;
}

export interface AlertaDoc {
  _id: string;
  shipmentId: string;
  regla: string;
  prioridad: string;
  causa: string;
  estado: "ABIERTA" | "CERRADA";
  abiertaEn: string;
  cerradaEn?: string;
}

export interface NotifDoc {
  _id: string;
  shipmentId: string;
  origen: string;
  mensaje: string;
  ocurridoEn: string;
}

export interface TorreData {
  contadores: Record<string, number>;
  total: number;
  alertas: AlertaDoc[];
  ultimos: { shipmentId: string; estado: string; zonaId: string; actualizadoEn: string }[];
}

export interface DetalleData {
  envio: EnvioDoc;
  alertas: AlertaDoc[];
  notificaciones: NotifDoc[];
}

export interface TrackingData {
  shipmentId: string;
  titulo: string;
  detalle: string;
  paso: number; // 0..4
  estimado: string | null;
}

export interface AnaliticaData {
  filtros: { zonas: string[]; hubs: string[]; fechas: string[] };
  zonaFranja: { zonaId: string; franja: string; total: number; entregados: number }[];
  porDia: { fecha: string; total: number; entregados: number }[];
  motivos: { zonaId: string; AUSENTE: number; DIRECCION_INCORRECTA: number; RECHAZADO: number; ZONA_INACCESIBLE: number }[];
  sla: { hubId: string; fecha: string; cumplidos: number; tarde: number }[];
  tiempos: { hubId: string; fecha: string; minutos: number }[];
}