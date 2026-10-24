import { connectMongo } from "../src/index";

const ok = (c: boolean, msg: string, det = "") => {
  console.log(`${c ? "✔" : "✘"} ${msg}${det ? ` (${det})` : ""}`);
  if (!c) process.exitCode = 1;
};
const PRIORIDAD: Record<string, string> = { SIN_INGRESO: "MEDIA", SIN_SALIDA: "ALTA", FALLO_DIA_LIMITE: "ALTA", VENCIDO: "CRITICA" };
const DECISIONES = ["REPROGRAMADO", "RETENIDO", "DEVOLUCION"];

const { client, db } = await connectMongo();
const envios = await db.collection("envios").find({}).toArray();
const porId = new Map(envios.map((e) => [e.shipmentId as string, e]));
const hist = (e: any): any[] => e.historial ?? [];
const estados = (e: any) => hist(e).filter((h) => typeof h.secuencia === "number");
console.log(`${envios.length} envíos analizados (correr con el sistema quieto: simulador detenido y lag en 0)\n`);

// --- Ciclo de vida
ok(envios.every((e) => new Set(hist(e).map((h) => h.eventId)).size === hist(e).length), "sin eventos repetidos en el historial");
ok(
  envios.every((e) => {
    const s = estados(e).map((h) => h.secuencia as number);
    return s.every((x, i) => i === 0 || x > s[i - 1]) && estados(e).at(-1)?.tipo === e.estado;
  }),
  "el estado nunca retrocede (secuencias crecientes y estado = último aplicado)",
);

// --- Entrega fallida
const notifs = new Map<string, number>(
  (
    await db
      .collection("notificaciones")
      .aggregate([{ $match: { origen: "ENTREGA_FALLIDA" } }, { $group: { _id: "$shipmentId", n: { $sum: 1 } } }])
      .toArray()
  ).map((r) => [r._id as string, r.n as number]),
);
const malFallo = envios.filter((e) => {
  const fallos = hist(e).filter((h) => h.tipo === "ENTREGA_FALLIDA").length;
  const reprogs = hist(e).filter((h) => DECISIONES.includes(h.tipo)).length;
  return (notifs.get(e.shipmentId) ?? 0) !== fallos || reprogs !== fallos;
});
ok(malFallo.length === 0, "cada ENTREGA_FALLIDA tiene exactamente una notificación y una reprogramación", `${malFallo.length} envíos no coinciden`);

const regla = (h: any): boolean => {
  if (h.tipo === "REPROGRAMADO") {
    const dow = new Date(`${h.nuevaFecha}T00:00:00Z`).getUTCDay();
    return ["AUSENTE", "ZONA_INACCESIBLE"].includes(h.motivo) && h.intento >= 2 && h.intento <= 3 && dow >= 1 && dow <= 5;
  }
  if (h.tipo === "RETENIDO") return h.motivo === "DIRECCION_INCORRECTA" && h.intento < 3;
  return h.motivo === "RECHAZADO" || h.intento >= 3; // DEVOLUCION
};
const malRegla = envios.filter((e) => hist(e).some((h) => DECISIONES.includes(h.tipo) && !regla(h)));
ok(malRegla.length === 0, "cada motivo aplica su regla de reprogramación (y el tercer fallo termina en devolución)", `${malRegla.length} envíos violan una regla`);

// --- Riesgo de SLA
const alertas = await db.collection("alertas").find({}).toArray();
ok(alertas.every((a) => a.prioridad === PRIORIDAD[a.regla]), "cada alerta tiene la prioridad de su regla");
console.log("  alertas por regla: " + Object.keys(PRIORIDAD).map((r) => `${r}=${alertas.filter((a) => a.regla === r).length}`).join("  "));
const sinCerrar = alertas.filter((a) => a.estado === "ABIERTA" && porId.get(a.shipmentId)?.estado === "ENTREGADO");
ok(sinCerrar.length === 0, "ninguna alerta abierta sobre un envío ya entregado", `${sinCerrar.length} sin cerrar`);

// --- Analítica: recuento directo desde el historial vs metricas_diarias
const cuenta = { total: 0, entregados: 0, aTiempo: 0, tarde: 0 } as Record<string, number>;
const motivos: Record<string, number> = {};
for (const e of envios) {
  for (const h of hist(e)) {
    if (h.tipo !== "ENTREGADO" && h.tipo !== "ENTREGA_FALLIDA") continue;
    if (h.intento === 1) {
      cuenta.total++;
      if (h.tipo === "ENTREGADO") cuenta.entregados++;
    }
    if (h.tipo === "ENTREGA_FALLIDA" && h.motivo) motivos[h.motivo] = (motivos[h.motivo] ?? 0) + 1;
  }
  const ent = hist(e).find((h) => h.tipo === "ENTREGADO");
  if (ent && e.promesa) (ent.ocurridoEn > e.promesa.venceEn ? cuenta.tarde++ : cuenta.aTiempo++);
}
const [m] = await db
  .collection("metricas_diarias")
  .aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: "$primerIntento.total" },
        entregados: { $sum: "$primerIntento.entregados" },
        aTiempo: { $sum: "$sla.cumplidos" },
        tarde: { $sum: "$sla.tarde" },
        AUSENTE: { $sum: "$motivos.AUSENTE" },
        DIRECCION_INCORRECTA: { $sum: "$motivos.DIRECCION_INCORRECTA" },
        RECHAZADO: { $sum: "$motivos.RECHAZADO" },
        ZONA_INACCESIBLE: { $sum: "$motivos.ZONA_INACCESIBLE" },
      },
    },
  ])
  .toArray();
const k = (o: any, c: string) => o?.[c] ?? 0;
const difs = [
  ...["total", "entregados", "aTiempo", "tarde"].filter((c) => k(m, c) !== k(cuenta, c)).map((c) => `${c}: analítica=${k(m, c)} recuento=${k(cuenta, c)}`),
  ...["AUSENTE", "DIRECCION_INCORRECTA", "RECHAZADO", "ZONA_INACCESIBLE"].filter((c) => k(m, c) !== k(motivos, c)).map((c) => `${c}: analítica=${k(m, c)} recuento=${k(motivos, c)}`),
];
ok(difs.length === 0, "los tres indicadores coinciden con el recuento manual", difs.join("; "));

await client.close();