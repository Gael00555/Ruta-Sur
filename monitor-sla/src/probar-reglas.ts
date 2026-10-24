import { evaluarReglas, type Seguimiento } from "./reglas";

const H = 3_600_000;
const vence = Date.parse("2026-03-03T20:00:00.000Z");
const base: Seguimiento = {
  _id: "T", hubId: "H", zonaId: "Z", repartidorId: null, estado: "CREADO",
  ultimaSecuencia: 1, venceEn: vence, ultimoFalloEn: null, alertadas: [], cerradas: [],
};
const evaluar = (s: Partial<Seguimiento>, ahora: number) =>
  evaluarReglas({ ...base, ...s }, ahora).map((a) => `${a.tipo}:${a.regla}`).join(",") || "-";

let fallos = 0;
const t = (nombre: string, real: string, esperado: string) => {
  const ok = real === esperado;
  if (!ok) fallos++;
  console.log(`${ok ? "✔" : "✘"} ${nombre}${ok ? "" : `  -> ${real} (esperado ${esperado})`}`);
};

t("SIN_INGRESO: faltan 9 h y sigue CREADO", evaluar({}, vence - 9 * H), "ALERTA_ABIERTA:SIN_INGRESO");
t("SIN_INGRESO: faltan 11 h, todavía no", evaluar({}, vence - 11 * H), "-");
t("SIN_INGRESO: ya ingresó al hub", evaluar({ estado: "INGRESADO_HUB" }, vence - 9 * H), "-");
t("SIN_SALIDA: faltan 3 h y está clasificado", evaluar({ estado: "CLASIFICADO" }, vence - 3 * H), "ALERTA_ABIERTA:SIN_SALIDA");
t("SIN_SALIDA: faltan 3 h pero ya está en reparto", evaluar({ estado: "EN_REPARTO" }, vence - 3 * H), "-");
t("FALLO_DIA_LIMITE: falla el día del vencimiento", evaluar({ estado: "ENTREGA_FALLIDA", ultimoFalloEn: vence - 6 * H }, vence - 5 * H), "ALERTA_ABIERTA:FALLO_DIA_LIMITE");
t("VENCIDO: pasó el vencimiento sin entrega", evaluar({ estado: "EN_REPARTO" }, vence + H), "ALERTA_ABIERTA:VENCIDO");
t("sin repetición: la regla ya alertó", evaluar({ estado: "EN_REPARTO", alertadas: ["VENCIDO"] }, vence + H), "-");
t("cierre: se entregó con una alerta abierta", evaluar({ estado: "ENTREGADO", alertadas: ["SIN_SALIDA"] }, vence - H), "ALERTA_CERRADA:SIN_SALIDA");
t("cierre: no se repite", evaluar({ estado: "ENTREGADO", alertadas: ["SIN_SALIDA"], cerradas: ["SIN_SALIDA"] }, vence - H), "-");

process.exit(fallos ? 1 : 0);