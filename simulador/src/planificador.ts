import { TOPICS, franjaDe, type EstadoEvent, type Franja, type Motivo, type PromesaEvent } from "@rutasur/shared";
import { params, type Zona } from "./config";
import type { Rng } from "./rng";
import { DIA, HORA, MIN, inicioDia, proximaSalida, vencimiento } from "./tiempo";

/** Mensaje programado: se emite cuando el reloj simulado llega a `emitirEn`. */
export interface Item {
  emitirEn: number;
  ocurrio: number;
  topic: string;
  clave: string;
  valor: string;
}

export interface OpcionesPlan {
  shipmentId: string;
  creadoEn: number;
  zona: Zona;
  rng: Rng;
  compacto?: boolean; // escenarios de demo: pasos de 20 min, reintento a 1 h
  ruido?: boolean; // duplicados, fuera de orden y malformados
  resultados?: (Motivo | null)[]; // resultado forzado por intento (null = entregado)
  detenerEnHub?: boolean;
  venceEn?: number;
}

function sortear(rng: Rng, zona: Zona, iso: string): Motivo | null {
  // la zona fija el promedio; por la mañana se falla más (hay más gente ausente)
  const factor = franjaDe(iso) === "MANANA" ? 1.25 : 0.75;
  if (rng() >= zona.fallo * factor) return null;
  let r = rng();
  for (const [motivo, p] of params.motivos) {
    r -= p;
    if (r < 0) return motivo;
  }
  return "AUSENTE";
}

function corromper(ev: EstadoEvent, rng: Rng): string {
  const id = `${ev.eventId}-X`;
  switch (Math.floor(rng() * 4)) {
    case 0: {
      const { tipo: _tipo, ...resto } = ev;
      return JSON.stringify({ ...resto, eventId: id }); // sin tipo
    }
    case 1:
      return JSON.stringify({ ...ev, eventId: id, tipo: "VOLANDO" }); // tipo inexistente
    case 2:
      return JSON.stringify({ ...ev, eventId: id, secuencia: "uno" }); // tipo de dato erróneo
    default:
      return JSON.stringify(ev).slice(0, 40); // JSON truncado
  }
}

function conRuido(items: Item[], rng: Rng): Item[] {
  const extra: Item[] = [];
  const estados = items.filter((i) => i.topic === TOPICS.ESTADOS);
  estados.forEach((it, idx) => {
    const ev = JSON.parse(it.valor) as EstadoEvent;
    // duplicado: misma copia (mismo eventId) un poco más tarde
    if (rng() < params.pDuplicado) extra.push({ ...it, emitirEn: it.emitirEn + rng() * 5 * MIN });
    // fuera de orden: solo CLASIFICADO, que llega después del estado siguiente
    if (ev.tipo === "CLASIFICADO" && rng() < params.pFueraDeOrden && estados[idx + 1]) {
      it.emitirEn = estados[idx + 1].ocurrio + 11 * MIN;
    }
    // malformado: mensaje EXTRA corrupto (el evento válido igual se emite)
    if (rng() < params.pMalformado) {
      extra.push({ ...it, valor: corromper(ev, rng), emitirEn: it.emitirEn + rng() * 5 * MIN });
    }
  });
  return [...items, ...extra];
}

/** Genera de una vez toda la vida de un envío, con su tiempo simulado. */
export function planificar(o: OpcionesPlan): Item[] {
  const { shipmentId, zona, rng } = o;
  const compacto = !!o.compacto;
  const items: Item[] = [];
  const venceEn = o.venceEn ?? vencimiento(o.creadoEn);
  const iso = (t: number) => new Date(t).toISOString();

  let seq = 0;
  let intento = 1;
  let repartidorId: string | null = null;
  let t = o.creadoEn;

  const base = (at: number, secuencia: number) => ({
    shipmentId,
    ocurridoEn: iso(at),
    secuencia,
    hubId: zona.hubId,
    zonaId: zona.zonaId,
    repartidorId,
    version: 1 as const,
  });

  const promesa: PromesaEvent = { ...base(t, 0), eventId: `${shipmentId}-P`, tipo: "PROMESA", venceEn: iso(venceEn) };
  items.push({ emitirEn: t, ocurrio: t, topic: TOPICS.PROMESAS, clave: shipmentId, valor: JSON.stringify(promesa) });

  const estado = (tipo: EstadoEvent["tipo"], at: number, motivo?: Motivo) => {
    seq += 1;
    const ev: EstadoEvent = { ...base(at, seq), eventId: `${shipmentId}-E${seq}`, tipo, intento, ...(motivo ? { motivo } : {}) };
    // eventos del repartidor: llegan con demora de sincronización (0-10 min)
    const sync = tipo === "EN_REPARTO" || tipo === "ENTREGADO" || tipo === "ENTREGA_FALLIDA" ? rng() * 10 * MIN : 0;
    items.push({ emitirEn: at + sync, ocurrio: at, topic: TOPICS.ESTADOS, clave: shipmentId, valor: JSON.stringify(ev) });
  };

  estado("CREADO", t);

  // ingreso al hub; con 10% de probabilidad se demora hasta pocas horas del vencimiento
  const demorado = !compacto && rng() < params.pDemoraHub;
  t = compacto ? t + 20 * MIN : demorado ? venceEn - (5 + rng() * 4) * HORA : t + (1 + rng() * 3) * HORA;
  estado("INGRESADO_HUB", t);
  if (o.detenerEnHub) return items;

  t += compacto ? 20 * MIN : (0.5 + rng() * 1.5) * HORA;
  repartidorId = `REP-${zona.zonaId}-${1 + Math.floor(rng() * 13)}`;
  estado("CLASIFICADO", t);

  let franja: Franja = rng() < 0.5 ? "MANANA" : "TARDE";
  let desde = t;
  for (;;) {
    t = compacto ? t + 20 * MIN : proximaSalida(desde, franja, rng);
    estado("EN_REPARTO", t);
    t += compacto ? 20 * MIN : (0.5 + rng() * 2) * HORA;

    const forzado = o.resultados && o.resultados.length > intento - 1;
    const motivo = forzado ? o.resultados![intento - 1] : sortear(rng, zona, iso(t));

    if (motivo === null) {
      estado("ENTREGADO", t);
      break;
    }
    estado("ENTREGA_FALLIDA", t, motivo);
    // finales: tercer fallo, dirección incorrecta (retenido) o rechazo (devolución)
    if (intento >= 3 || motivo === "DIRECCION_INCORRECTA" || motivo === "RECHAZADO") break;

    // AUSENTE / ZONA_INACCESIBLE: nuevo intento el día hábil siguiente, franja opuesta
    const tFallo = t;
    intento += 1;
    t += compacto ? 60 * MIN : (0.5 + rng()) * HORA;
    estado("CLASIFICADO", t);
    franja = franjaDe(iso(tFallo)) === "MANANA" ? "TARDE" : "MANANA";
    desde = inicioDia(tFallo) + DIA;
  }

  return o.ruido ? conRuido(items, rng) : items;
}