import Esperando from "@/components/Esperando";
import TrackingLive from "@/components/TrackingLive";
import { trackingPublico } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await trackingPublico(id);
  if (!data) {
    return (
      <main>
        <Esperando id={id} />
      </main>
    );
  }
  return <TrackingLive inicial={data} />;
}