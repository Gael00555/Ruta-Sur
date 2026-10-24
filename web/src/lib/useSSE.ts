"use client";
import { useEffect, useRef, useState } from "react";

/** Se conecta al canal SSE y llama a `onData` con cada evento. Devuelve si la conexión está viva. */
export function useSSE<T>(url: string, evento: string, onData: (d: T) => void): boolean {
  const cb = useRef(onData);
  cb.current = onData;
  const [vivo, setVivo] = useState(false);

  useEffect(() => {
    const es = new EventSource(url); // el navegador reconecta solo si se corta
    es.onopen = () => setVivo(true);
    es.onerror = () => setVivo(false);
    es.addEventListener(evento, (e) => cb.current(JSON.parse((e as MessageEvent).data) as T));
    return () => es.close();
  }, [url, evento]);

  return vivo;
}