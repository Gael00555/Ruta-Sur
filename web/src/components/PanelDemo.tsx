"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

const ESCENARIOS = [
  { id: "feliz", titulo: "Envío feliz", desc: "Recorre todos los estados sin incidentes (~40 s)." },
  { id: "ausente", titulo: "Ausente", desc: "Falla por ausencia y se reprograma (~1,5 min)." },
  { id: "demorado", titulo: "Demorado", desc: "Queda detenido en el hub: alerta SIN_SALIDA a los ~30 s." },
  { id: "tercer-fallo", titulo: "Tercer fallo", desc: "Agota los 3 intentos y pasa a devolución (~2,5 min)." },
  { id: "malformado", titulo: "Evento inválido", desc: "Inyecta un evento malformado: va a la DLQ." },
  { id: "rafaga", titulo: "Ráfaga", desc: "500 envíos en pocos segundos." },
];
const CON_DETALLE = ["feliz", "ausente", "demorado", "tercer-fallo"];

interface Lanzado { escenario: string; ok: boolean; detalle: string }
interface Sim { simulado: string; creados: number; emitidos: number; pendientes: number }

const COMANDOS = `# lag de cada grupo de consumidores (paso 5: caída de un servicio)
docker exec rutasur-kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --all-groups

# eventos inválidos en la DLQ (paso 6)
docker exec rutasur-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic envios.estados.dlq --from-beginning`;

export default function PanelDemo() {
  const [log, setLog] = useState<Lanzado[]>([]);
  const [sim, setSim] = useState<Sim | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/demo/estado", { cache: "no-store" });
        setSim(r.ok ? ((await r.json()) as Sim) : null);
      } catch {
        setSim(null);
      }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);

  async function lanzar(id: string) {
    setOcupado(id);
    let item: Lanzado;
    try {
      const r = await fetch(`/api/demo/${id}`, { method: "POST" });
      const j = await r.json();
      item = { escenario: id, ok: !!j.ok, detalle: String(j.detalle ?? j.error ?? "") };
    } catch {
      item = { escenario: id, ok: false, detalle: "No se pudo contactar a la web" };
    }
    setLog((l) => [item, ...l].slice(0, 10));
    setOcupado(null);
  }

  return (
    <>
      <h1>Panel de demo</h1>

      <div className="card">
        {sim ? (
          <>
            <span className="vivo">simulador conectado</span> · reloj simulado <strong>{sim.simulado.slice(0, 16).replace("T", " ")}</strong> ·{" "}
            {sim.creados} envíos creados · {sim.emitidos} eventos emitidos · {sim.pendientes} pendientes
          </>
        ) : (
          <span className="vivo off">El simulador no responde. ¿Está corriendo?</span>
        )}
      </div>

      <div className="grid cont" style={{ marginTop: 16 }}>
        {ESCENARIOS.map((e) => (
          <div className="card" key={e.id}>
            <h2>{e.titulo}</h2>
            <p className="mut">{e.desc}</p>
            <button disabled={ocupado !== null} onClick={() => lanzar(e.id)}>
              {ocupado === e.id ? "Lanzando…" : "Disparar"}
            </button>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Lanzados</h2>
        <table>
          <tbody>
            {log.map((l, i) => (
              <tr key={i}>
                <td>{l.escenario}</td>
                <td className={l.ok ? "" : "mut"}>{l.detalle}</td>
                <td>
                  {l.ok && CON_DETALLE.includes(l.escenario) && (
                    <>
                      <Link href={`/envios/${l.detalle}`}>detalle</Link> · <Link href={`/tracking/${l.detalle}`}>tracking</Link>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {log.length === 0 && <tr><td className="mut">Todavía no lanzaste nada</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Comandos útiles para la demo</h2>
        <pre>{COMANDOS}</pre>
      </div>
    </>
  );
}