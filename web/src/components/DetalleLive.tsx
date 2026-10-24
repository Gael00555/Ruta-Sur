"use client";
import Link from "next/link";
import { useState } from "react";
import { useSSE } from "@/lib/useSSE";
import type { DetalleData, HistorialItem } from "@/lib/tipos";
import { fmt } from "@/lib/util";

const esReprog = (t: string) => ["REPROGRAMADO", "RETENIDO", "DEVOLUCION"].includes(t);

// por hora del evento; en un empate, el estado va antes que la decisión que provocó
const ordenar = (h: HistorialItem[]) =>
  [...h].sort((a, b) => a.ocurridoEn.localeCompare(b.ocurridoEn) || Number(esReprog(a.tipo)) - Number(esReprog(b.tipo)));

export default function DetalleLive({ inicial }: { inicial: DetalleData }) {
  const [d, setD] = useState(inicial);
  const id = inicial.envio.shipmentId;
  const vivo = useSSE<DetalleData | null>(`/api/stream?vista=detalle&id=${id}`, "detalle", (x) => x && setD(x));
  const { envio: e, alertas, notificaciones } = d;
  const historial = ordenar(e.historial ?? []);
  const r = e.reprogramacion;

  return (
    <>
      <h1>
        {id} <span className={`badge b-${e.estado}`}>{e.estado ?? "—"}</span>{" "}
        <span className={`mut vivo ${vivo ? "" : "off"}`}>{vivo ? "en vivo" : "reconectando"}</span>
      </h1>

      <div className="grid dos">
        <div className="card">
          <h2>Datos</h2>
          <table>
            <tbody>
              <tr><td>Hub / zona</td><td>{e.hubId} / {e.zonaId}</td></tr>
              <tr><td>Repartidor</td><td>{e.repartidorId ?? "sin asignar"}</td></tr>
              <tr><td>Intento</td><td>{e.intento ?? 1} de 3</td></tr>
              <tr><td>Promesa vence</td><td>{fmt(e.promesa?.venceEn)}</td></tr>
              {r && (
                <tr>
                  <td>Última decisión</td>
                  <td>{r.tipo}{r.nuevaFecha ? ` · ${r.nuevaFecha} (${r.franja})` : ""}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p><Link href={`/tracking/${id}`}>Ver tracking público</Link></p>
        </div>

        <div className="card">
          <h2>Línea de tiempo</h2>
          <ul className="tl">
            {historial.map((h) => (
              <li key={h.eventId}>
                <span className="mut">{fmt(h.ocurridoEn)}</span> <span className={`badge b-${h.tipo}`}>{h.tipo}</span>
                {h.intento ? <span className="mut"> · intento {h.intento}</span> : null}
                {h.motivo ? <span className="mut"> · {h.motivo}</span> : null}
                {h.nuevaFecha ? <span className="mut"> · {h.nuevaFecha} ({h.franja})</span> : null}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid dos">
        <div className="card">
          <h2>Alertas ({alertas.length})</h2>
          <table>
            <tbody>
              {alertas.map((a) => (
                <tr key={a._id}>
                  <td><span className={`badge b-${a.prioridad}`}>{a.prioridad}</span></td>
                  <td>{a.regla}</td>
                  <td>{a.estado}</td>
                  <td className="mut">{fmt(a.abiertaEn)}</td>
                </tr>
              ))}
              {alertas.length === 0 && <tr><td className="mut">Sin alertas</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Notificaciones ({notificaciones.length})</h2>
          <ul className="tl">
            {notificaciones.map((n) => (
              <li key={n._id}>
                <span className="mut">{fmt(n.ocurridoEn)} · {n.origen}</span>
                <div>{n.mensaje}</div>
              </li>
            ))}
            {notificaciones.length === 0 && <li className="mut">Sin notificaciones</li>}
          </ul>
        </div>
      </div>
    </>
  );
}