import { analitica } from "@/lib/queries";

export const dynamic = "force-dynamic";

const pct = (a: number, b: number) => (b ? Math.round((1000 * a) / b) / 10 : 0);
const FRANJA: Record<string, string> = { MANANA: "Mañana", TARDE: "Tarde" };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const f = { zona: sp.zona, hub: sp.hub, fecha: sp.fecha };
  const d = await analitica(f);

  const filas = d.zonaFranja.map((r) => ({ ...r, tasa: pct(r.entregados, r.total) })).sort((a, b) => a.tasa - b.tasa);
  const peor = filas.find((r) => r.total >= 5); // ignora celdas con muy pocos envíos

  return (
    <>
      <h1>Analítica</h1>

      <form className="filtros">
        <label>
          Zona
          <select name="zona" defaultValue={f.zona ?? ""}>
            <option value="">Todas</option>
            {d.filtros.zonas.map((z) => <option key={z}>{z}</option>)}
          </select>
        </label>
        <label>
          Hub
          <select name="hub" defaultValue={f.hub ?? ""}>
            <option value="">Todos</option>
            {d.filtros.hubs.map((h) => <option key={h}>{h}</option>)}
          </select>
        </label>
        <label>
          Fecha
          <select name="fecha" defaultValue={f.fecha ?? ""}>
            <option value="">Todas</option>
            {d.filtros.fechas.map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <button type="submit">Filtrar</button>
      </form>

      <div className="grid dos">
        <div className="card">
          <h2>Entrega en primer intento</h2>
          <p className="mut">¿Dónde y cuándo fallamos más? Ordenado de peor a mejor.</p>
          <table>
            <thead><tr><th>Zona</th><th>Franja</th><th>Intentos</th><th>Éxito</th><th></th></tr></thead>
            <tbody>
              {filas.map((r) => (
                <tr key={r.zonaId + r.franja}>
                  <td>{r.zonaId}</td>
                  <td>{FRANJA[r.franja] ?? r.franja}</td>
                  <td>{r.total}</td>
                  <td>
                    {r.tasa}% <span className={`barra ${r.tasa < 75 ? "mal" : ""}`}><div style={{ width: `${r.tasa}%` }} /></span>
                  </td>
                  <td>{r === peor && <span className="badge peor">más fallos</span>}</td>
                </tr>
              ))}
              {filas.length === 0 && <tr><td className="mut">Sin datos</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Primer intento por día</h2>
          <table>
            <thead><tr><th>Día</th><th>Intentos</th><th>Éxito</th></tr></thead>
            <tbody>
              {d.porDia.map((r) => (
                <tr key={r.fecha}>
                  <td>{r.fecha}</td>
                  <td>{r.total}</td>
                  <td>{pct(r.entregados, r.total)}%</td>
                </tr>
              ))}
              {d.porDia.length === 0 && <tr><td className="mut">Sin datos</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid dos">
        <div className="card">
          <h2>Motivos de fallo por zona</h2>
          <p className="mut">¿Por qué fallamos?</p>
          <table>
            <thead><tr><th>Zona</th><th>Ausente</th><th>Dirección</th><th>Rechazo</th><th>Inaccesible</th></tr></thead>
            <tbody>
              {d.motivos.map((r) => (
                <tr key={r.zonaId}>
                  <td>{r.zonaId}</td>
                  <td>{r.AUSENTE}</td>
                  <td>{r.DIRECCION_INCORRECTA}</td>
                  <td>{r.RECHAZADO}</td>
                  <td>{r.ZONA_INACCESIBLE}</td>
                </tr>
              ))}
              {d.motivos.length === 0 && <tr><td className="mut">Sin datos</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>Cumplimiento de SLA por hub</h2>
          <p className="mut">¿Qué hub llega tarde? (sobre envíos ya entregados)</p>
          <table>
            <thead><tr><th>Hub</th><th>Día</th><th>A tiempo</th><th>Tarde</th><th>Cumple</th></tr></thead>
            <tbody>
              {d.sla.map((r) => (
                <tr key={r.hubId + r.fecha}>
                  <td>{r.hubId}</td>
                  <td>{r.fecha}</td>
                  <td>{r.cumplidos}</td>
                  <td>{r.tarde}</td>
                  <td>{pct(r.cumplidos, r.cumplidos + r.tarde)}%</td>
                </tr>
              ))}
              {d.sla.length === 0 && <tr><td className="mut">Sin datos</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Tiempo medio en hub (INGRESADO_HUB → EN_REPARTO)</h2>
        {d.tiempos.length === 0 ? (
          <p className="mut">Indicador todavía no activado: se agrega con el reprocesamiento (paso 8 de la demo).</p>
        ) : (
          <table>
            <thead><tr><th>Hub</th><th>Día</th><th>Minutos</th></tr></thead>
            <tbody>
              {d.tiempos.map((r) => (
                <tr key={r.hubId + r.fecha}>
                  <td>{r.hubId}</td>
                  <td>{r.fecha}</td>
                  <td>{r.minutos}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}