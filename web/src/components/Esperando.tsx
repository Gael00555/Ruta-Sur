"use client";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

export default function Esperando({ id }: { id: string }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(t);
  }, [router]);
  return (
    <div className="card pub">
      <h1>Esperando datos…</h1>
      <p className="mut">Todavía no llegó ningún evento del envío {id}. Esta página se actualiza sola.</p>
    </div>
  );
}