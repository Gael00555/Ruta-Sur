import type { Franja } from "@rutasur/shared";
import type { Rng } from "./rng";

export const MIN = 60_000;
export const HORA = 3_600_000;
export const DIA = 86_400_000;

export const inicioDia = (t: number) => Math.floor(t / DIA) * DIA;

export function esHabil(t: number): boolean {
  const d = new Date(t).getUTCDay();
  return d >= 1 && d <= 5;
}

export function siguienteDiaHabil(t: number): number {
  let d = inicioDia(t) + DIA;
  while (!esHabil(d)) d += DIA;
  return d;
}

/** La promesa vence a las 20:00 del día hábil siguiente a la creación. */
export const vencimiento = (creadoEn: number) => siguienteDiaHabil(creadoEn) + 20 * HORA;

/** Próxima salida a reparto en un día hábil: mañana 8-10 h, tarde 13-14:30 h. */
export function proximaSalida(desde: number, franja: Franja, rng: Rng): number {
  let dia = inicioDia(desde);
  for (;;) {
    if (esHabil(dia)) {
      const hora = franja === "MANANA" ? 8 + rng() * 2 : 13 + rng() * 1.5;
      const salida = dia + hora * HORA;
      if (salida >= desde + 30 * MIN) return salida;
    }
    dia += DIA;
  }
}