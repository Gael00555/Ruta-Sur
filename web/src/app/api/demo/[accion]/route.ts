export const dynamic = "force-dynamic";

const SIM = process.env.SIM_URL ?? "http://localhost:4001";
const ESCENARIOS = ["feliz", "ausente", "demorado", "tercer-fallo", "malformado", "rafaga"];

type Ctx = { params: Promise<{ accion: string }> };

async function reenviar(url: string, method: "GET" | "POST") {
  try {
    const r = await fetch(url, { method, cache: "no-store" });
    return Response.json(await r.json(), { status: r.status });
  } catch {
    return Response.json({ ok: false, error: "El simulador no responde. ¿Está corriendo?" }, { status: 502 });
  }
}

// POST /api/demo/<escenario>  -> dispara el escenario en el simulador
export async function POST(_req: Request, { params }: Ctx) {
  const { accion } = await params;
  if (!ESCENARIOS.includes(accion)) return Response.json({ ok: false, error: "escenario desconocido" }, { status: 404 });
  return reenviar(`${SIM}/escenarios/${accion}`, "POST");
}

// GET /api/demo/estado  -> reloj simulado y contadores del simulador
export async function GET(_req: Request, { params }: Ctx) {
  const { accion } = await params;
  if (accion !== "estado") return Response.json({ ok: false }, { status: 404 });
  return reenviar(`${SIM}/estado`, "GET");
}