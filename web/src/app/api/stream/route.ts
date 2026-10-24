import { getDb } from "@/lib/db";
import { detalleEnvio, torre, trackingPublico } from "@/lib/queries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/stream?vista=torre | detalle&id=X | tracking&id=X
// Escucha los change streams de MongoDB y empuja por SSE una foto actualizada de la vista.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const vista = url.searchParams.get("vista") ?? "torre";
  const id = url.searchParams.get("id");
  const db = await getDb();
  const enc = new TextEncoder();

  const calcular = async (): Promise<[string, unknown] | null> => {
    if (vista === "torre") return ["torre", await torre()];
    if (vista === "detalle" && id) return ["detalle", await detalleEnvio(id)];
    if (vista === "tracking" && id) return ["tracking", await trackingPublico(id)];
    return null;
  };

  const colecciones = vista === "torre" ? ["envios", "alertas"] : vista === "tracking" ? ["envios"] : ["envios", "alertas", "notificaciones"];
  const pipeline = id && vista !== "torre" ? [{ $match: { "fullDocument.shipmentId": id } }] : [];

  let limpiar = () => {};
  const stream = new ReadableStream({
    start(controller) {
      let cerrado = false;
      let pendiente: ReturnType<typeof setTimeout> | null = null;

      const enviar = (evento: string, datos: unknown) => {
        if (!cerrado) controller.enqueue(enc.encode(`event: ${evento}\ndata: ${JSON.stringify(datos)}\n\n`));
      };

      // agrupa ráfagas de cambios: como mucho una actualización cada 250 ms
      const empujar = () => {
        if (pendiente) return;
        pendiente = setTimeout(async () => {
          pendiente = null;
          try {
            const r = await calcular();
            if (r) enviar(r[0], r[1]);
          } catch {
            /* el próximo cambio reintenta */
          }
        }, 250);
      };

      const cursores = colecciones.map((c) => {
        const cs = db.collection(c).watch(pipeline, { fullDocument: "updateLookup" });
        cs.on("change", empujar);
        cs.on("error", () => limpiar());
        return cs;
      });
      const latido = setInterval(() => {
        if (!cerrado) controller.enqueue(enc.encode(": latido\n\n"));
      }, 15_000);

      limpiar = () => {
        if (cerrado) return;
        cerrado = true;
        clearInterval(latido);
        if (pendiente) clearTimeout(pendiente);
        cursores.forEach((c) => c.close().catch(() => undefined));
        try {
          controller.close();
        } catch {
          /* ya cerrado */
        }
      };
      req.signal.addEventListener("abort", limpiar);
      empujar(); // primera foto al conectar
    },
    cancel() {
      limpiar();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}