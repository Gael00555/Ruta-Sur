"use client";
import { useState } from "react";
import { useSSE } from "@/lib/useSSE";
import type { TrackingData } from "@/lib/tipos";

export default function TrackingLive({ inicial }: { inicial: TrackingData }) {
  const [t, setT] = useState(inicial);
  useSSE<TrackingData | null>(`/api/stream?vista=tracking&id=${inicial.shipmentId}`, "tracking", (x) => x && setT(x));

  return (
    <main>
      <div className="card pub">
        <p className="mut">Envío {t.shipmentId}</p>
        <h1>{t.titulo}</h1>
        <p>{t.detalle}</p>
        <div className="pasos">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className={`paso ${i <= t.paso ? "ok" : ""}`} />
          ))}
        </div>
        {t.estimado && (
          <p>
            <strong>Fecha estimada:</strong> {t.estimado}
          </p>
        )}
      </div>
    </main>
  );
}