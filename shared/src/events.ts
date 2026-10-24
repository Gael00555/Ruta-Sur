import { z, type ZodTypeAny } from "zod";

export const TOPICS = {
  ESTADOS: "envios.estados",
  PROMESAS: "envios.promesas",
  REPROGRAMACIONES: "envios.reprogramaciones",
  ALERTAS: "alertas.sla",
  NOTIFICACIONES: "notificaciones.enviadas",
  DLQ: "envios.estados.dlq",
} as const;

export const GRUPOS = {
  PROYECTOR: "proyector",
  NOTIFICACIONES: "notificaciones",
  REPROGRAMACION: "reprogramacion",
  MONITOR_SLA: "monitor-sla",
  ANALITICA: "analitica",
} as const;

export const TIPOS_ESTADO = ["CREADO", "INGRESADO_HUB", "CLASIFICADO", "EN_REPARTO", "ENTREGADO", "ENTREGA_FALLIDA"] as const;
export const MOTIVOS = ["AUSENTE", "DIRECCION_INCORRECTA", "RECHAZADO", "ZONA_INACCESIBLE"] as const;
export const FRANJAS = ["MANANA", "TARDE"] as const;
export const REGLAS_SLA = ["SIN_INGRESO", "SIN_SALIDA", "FALLO_DIA_LIMITE", "VENCIDO"] as const;
export const PRIORIDADES = ["MEDIA", "ALTA", "CRITICA"] as const;

const isoDate = z.string().datetime();

// Campos comunes a todo evento. En los eventos derivados (reprogramación, alerta,
// notificación) `secuencia` copia la del evento que los originó.
const base = {
  eventId: z.string().min(1),
  shipmentId: z.string().min(1),
  ocurridoEn: isoDate, // reloj simulado
  secuencia: z.number().int().nonnegative(),
  hubId: z.string().min(1),
  zonaId: z.string().min(1),
  repartidorId: z.string().min(1).nullable(), // null hasta CLASIFICADO
  version: z.literal(1),
};

export const EstadoEventSchema = z
  .object({
    ...base,
    tipo: z.enum(TIPOS_ESTADO),
    intento: z.number().int().min(1).max(3), // nº de intento de entrega (1..3)
    motivo: z.enum(MOTIVOS).optional(),
  })
  .superRefine((e, ctx) => {
    if (e.tipo === "ENTREGA_FALLIDA" && !e.motivo) {
      ctx.addIssue({ code: "custom", path: ["motivo"], message: "ENTREGA_FALLIDA requiere motivo" });
    }
  });

export const PromesaEventSchema = z.object({
  ...base,
  tipo: z.literal("PROMESA"),
  venceEn: isoDate,
});

export const ReprogramacionEventSchema = z.object({
  ...base,
  tipo: z.enum(["REPROGRAMADO", "RETENIDO", "DEVOLUCION"]),
  intento: z.number().int().min(1).max(3), // intento que se asigna (o que se agotó)
  motivo: z.enum(MOTIVOS),
  eventoOrigenId: z.string(),
  nuevaFecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  franja: z.enum(FRANJAS).optional(),
});

export const AlertaEventSchema = z.object({
  ...base,
  tipo: z.enum(["ALERTA_ABIERTA", "ALERTA_CERRADA"]),
  regla: z.enum(REGLAS_SLA),
  prioridad: z.enum(PRIORIDADES),
  causa: z.string(),
});

export const NotificacionEventSchema = z.object({
  ...base,
  tipo: z.literal("NOTIFICACION"),
  origen: z.enum(["ENTREGA_FALLIDA", "ALERTA_SLA"]),
  eventoOrigenId: z.string(),
  mensaje: z.string(),
});

export type EstadoEvent = z.infer<typeof EstadoEventSchema>;
export type PromesaEvent = z.infer<typeof PromesaEventSchema>;
export type ReprogramacionEvent = z.infer<typeof ReprogramacionEventSchema>;
export type AlertaEvent = z.infer<typeof AlertaEventSchema>;
export type NotificacionEvent = z.infer<typeof NotificacionEventSchema>;
export type AnyEvent = EstadoEvent | PromesaEvent | ReprogramacionEvent | AlertaEvent | NotificacionEvent;

export type Motivo = (typeof MOTIVOS)[number];
export type Franja = (typeof FRANJAS)[number];
export type ReglaSla = (typeof REGLAS_SLA)[number];
export type Prioridad = (typeof PRIORIDADES)[number];

export const SCHEMA_POR_TOPIC: Record<string, ZodTypeAny> = {
  [TOPICS.ESTADOS]: EstadoEventSchema,
  [TOPICS.PROMESAS]: PromesaEventSchema,
  [TOPICS.REPROGRAMACIONES]: ReprogramacionEventSchema,
  [TOPICS.ALERTAS]: AlertaEventSchema,
  [TOPICS.NOTIFICACIONES]: NotificacionEventSchema,
};

export type ParseResult = { ok: true; event: AnyEvent } | { ok: false; motivo: string };

export function parseEvent(topic: string, raw: string): ParseResult {
  const schema = SCHEMA_POR_TOPIC[topic];
  if (!schema) return { ok: false, motivo: `TOPIC_SIN_ESQUEMA:${topic}` };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, motivo: "JSON_INVALIDO" };
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join(".") || "(raíz)"}: ${i.message}`).join("; ");
    return { ok: false, motivo: `ESQUEMA_INVALIDO: ${detalle}` };
  }
  return { ok: true, event: r.data as AnyEvent };
}

// Franja y fecha se derivan del tiempo del evento (UTC, determinista).
export const franjaDe = (iso: string): Franja => (new Date(iso).getUTCHours() < 13 ? "MANANA" : "TARDE");
export const fechaDe = (iso: string): string => iso.slice(0, 10);