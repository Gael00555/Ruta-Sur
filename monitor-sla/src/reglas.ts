import { fechaDe, type EstadoEvent, type Prioridad, type ReglaSla } from "@rutasur/shared";

const HORA = 3_600_000;

export const PRIORIDAD: Record<ReglaSla, Prioridad> = {
  SIN_INGRESO: "MEDIA",
  SIN_SALIDA: "ALTA",
  FALLO_DIA_LIMITE: "ALTA",
  VENCIDO: "CRITICA",
};

/** Estado interno del monitor: una fila por envío (en memoria y respaldada en MongoDB). */
export interface Seguimiento {
  _id: string; // shipmentId
  hubId: string;
  zonaId: string;
  repartidorId: string | null;
  estado: EstadoEvent["tipo"] | null;
  ultimaSecuencia: number;
  venceEn: number | null; // ms, reloj simulado
  ultimoFalloEn: number | null; // ms, reloj simulado
  alertadas: ReglaSla[]; // reglas ya emitidas: una regla no alerta dos veces
  cerradas: ReglaSla[]; // cierres ya emitidos
}

export interface Accion {
  tipo: "ALERTA_ABIERTA" | "ALERTA_CERRADA";
  regla: ReglaSla;
  causa: string;
}

const ANTES_DE_REPARTO = ["CREADO", "INGRESADO_HUB", "CLASIFICADO"];

/** Reglas del TP como función pura: dado el estado de un envío y la hora simulada, qué hay que emitir. */
export function evaluarReglas(s: Seguimiento, ahora: number): Accion[] {
  const out: Accion[] = [];
  const abrir = (regla: ReglaSla, causa: string) => {
    if (!s.alertadas.includes(regla)) out.push({ tipo: "ALERTA_ABIERTA", regla, causa });
  };

  // cierre: el envío se entregó
  if (s.estado === "ENTREGADO") {
    for (const regla of s.alertadas) {
      if (!s.cerradas.includes(regla)) out.push({ tipo: "ALERTA_CERRADA", regla, causa: "Envío entregado" });
    }
    return out;
  }
  if (s.estado === null || s.venceEn === null) return out; // todavía no hay datos de los dos streams

  const resta = s.venceEn - ahora;

  if (resta > 0 && resta < 10 * HORA && s.estado === "CREADO") {
    abrir("SIN_INGRESO", "Faltan menos de 10 h para el vencimiento y el envío no ingresó al hub");
  }
  if (resta > 0 && resta < 4 * HORA && ANTES_DE_REPARTO.includes(s.estado)) {
    abrir("SIN_SALIDA", "Faltan menos de 4 h y el envío no salió a reparto");
  }
  if (s.ultimoFalloEn !== null && fechaDe(new Date(s.ultimoFalloEn).toISOString()) === fechaDe(new Date(s.venceEn).toISOString())) {
    abrir("FALLO_DIA_LIMITE", "Entrega fallida el mismo día en que vence la promesa");
  }
  if (resta <= 0) abrir("VENCIDO", "Pasó el vencimiento sin entrega");

  return out;
}