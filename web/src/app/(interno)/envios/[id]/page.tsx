import DetalleLive from "@/components/DetalleLive";
import Esperando from "@/components/Esperando";
import { detalleEnvio } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await detalleEnvio(id);
  if (!data) return <Esperando id={id} />;
  return <DetalleLive inicial={data} />;
}