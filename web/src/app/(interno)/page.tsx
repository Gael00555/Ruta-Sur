import TorreLive from "@/components/TorreLive";
import { torre } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <TorreLive inicial={await torre()} />;
}