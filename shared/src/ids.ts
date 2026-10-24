import { createHash } from "node:crypto";

// eventId determinista para eventos derivados: si el servicio reintenta tras un
// fallo, publica el mismo eventId y el proyector lo descarta como duplicado.
export function idDerivado(eventIdPadre: string, sufijo: string): string {
  return createHash("sha1").update(`${eventIdPadre}:${sufijo}`).digest("hex").slice(0, 32);
}
