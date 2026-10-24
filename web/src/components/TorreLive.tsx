"use client";
import Link from "next/link";
import { useState } from "react";
import { useSSE } from "@/lib/useSSE";
import type { TorreData } from "@/lib/tipos";
import { ESTADOS, fmt } from "@/lib/util";

export default function TorreLive({ inicial }: { inicial: TorreData }) {
  const [d, setD] = useState(inicial);
  const vivo = useSSE<TorreData>("/api/stream?vista=torre", "torre", setD);

  return (
    <>
      <h1>
        Torre de control <span className={`mut vivo ${vivo ? "" : "off"}`}>{vivo ? "en vivo" : "reconectando"}</span>
      </h1>

      <div className="grid cont">
        {ESTADOS.map((e) => (
          <div className="card" key={e}>
            <div className="mut">{e}</div>
            <div className="num">{d.contadores[e] ?? 0}</div>
          </div>
        ))}
      </div>
      <p className="mut">{d.total} envíos en total</p>

      <div className="grid dos">
        <div className="card">
          <h2>Alertas abiertas ({d.alertas.length})</h2>
          <table>
            <tbody>
              {d.alertas.map((a) => (
                <tr key={a._id}>
                  <td><span className={`badge b-${a.prioridad}`}>{a.prioridad}</span></td>
                  <td><Link href={`/envios/${a.shipmentId}`}>{a.shipmentId}</Link></td>
                  <td>{a.regla}</td>
                  <td className="mut">{fmt(a.abiertaEn)}</td>
                </tr>
              ))}
              {d.alertas.length === 0 && <tr><td className="mut">Sin alertas abiertas</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Últimos eventos</h2>
          <table>
            <tbody>
              {d.ultimos.map((u) => (
                <tr key={u.shipmentId}>
                  <td><Link href={`/envios/${u.shipmentId}`}>{u.shipmentId}</Link></td>
                  <td><span className={`badge b-${u.estado}`}>{u.estado}</span></td>
                  <td>{u.zonaId}</td>
                  <td className="mut">{fmt(u.actualizadoEn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}