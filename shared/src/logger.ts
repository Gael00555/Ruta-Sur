type Nivel = "info" | "warn" | "error";

export function crearLogger(servicio: string) {
  const log = (nivel: Nivel, msg: string, extra?: Record<string, unknown>) =>
    console.log(JSON.stringify({ t: new Date().toISOString(), servicio, nivel, msg, ...extra }));
  return {
    info: (m: string, e?: Record<string, unknown>) => log("info", m, e),
    warn: (m: string, e?: Record<string, unknown>) => log("warn", m, e),
    error: (m: string, e?: Record<string, unknown>) => log("error", m, e),
  };
}
export type Logger = ReturnType<typeof crearLogger>;
