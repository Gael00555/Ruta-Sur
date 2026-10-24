import { franjaDe, type EstadoEvent, type Franja, type ReprogramacionEvent } from "@rutasur/shared";

const DIA = 86_400_000;

/** Próximo día hábil (lunes a viernes) después de la fecha del evento, como YYYY-MM-DD. */
export function siguienteDiaHabil(iso: string): string {
  let d = Date.parse(iso.slice(0, 10)) + DIA;
  for (;;) {
    const dow = new Date(d).getUTCDay();
    if (dow >= 1 && dow <= 5) break;
    d += DIA;
  }
  return new Date(d).toISOString().slice(0, 10);
}

export interface Decision {
  tipo: ReprogramacionEvent["tipo"];
  intento: number;
  nuevaFecha?: string;
  franja?: Franja;
}

/** Reglas de reprogramación del TP. `ev` debe ser una ENTREGA_FALLIDA con motivo. */
export function decidir(ev: EstadoEvent): Decision {
  // tercer fallo, cualquiera sea el motivo, o rechazo -> devolución al comercio
  if (ev.intento >= 3 || ev.motivo === "RECHAZADO") return { tipo: "DEVOLUCION", intento: ev.intento };
  // dirección incorrecta -> retenido hasta una corrección, no se reprograma solo
  if (ev.motivo === "DIRECCION_INCORRECTA") return { tipo: "RETENIDO", intento: ev.intento };
  // AUSENTE y ZONA_INACCESIBLE -> día hábil siguiente, franja opuesta a la del fallo
  const franja: Franja = franjaDe(ev.ocurridoEn) === "MANANA" ? "TARDE" : "MANANA";
  return { tipo: "REPROGRAMADO", intento: ev.intento + 1, nuevaFecha: siguienteDiaHabil(ev.ocurridoEn), franja };
}