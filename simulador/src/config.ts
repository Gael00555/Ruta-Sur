import { config as shared, type Motivo } from "@rutasur/shared";

const num = (k: string, def: number) => Number(process.env[k] ?? def);

export const params = {
  enviosPorMinuto: num("ENVIOS_POR_MINUTO", 20),
  semilla: process.env.SEMILLA ?? "42",
  simInicio: Date.parse(process.env.SIM_INICIO ?? "2026-03-02T06:00:00.000Z"), // un lunes
  maxEnvios: num("MAX_ENVIOS", Infinity),
  puerto: num("SIM_PUERTO", 4001),
  aceleracion: shared.aceleracion,
  pDemoraHub: 0.1,
  pDuplicado: 0.02,
  pFueraDeOrden: 0.02,
  pMalformado: 0.01,
  motivos: [
    ["AUSENTE", 0.6],
    ["DIRECCION_INCORRECTA", 0.2],
    ["RECHAZADO", 0.15],
    ["ZONA_INACCESIBLE", 0.05],
  ] as [Motivo, number][],
};

export interface Zona {
  zonaId: string;
  hubId: string;
  fallo: number; // tasa de fallo promedio de la zona
}

// 3 hubs x 3 zonas. Tasas entre 5% y 30% (promedio ~17%, cerca del 18% del caso).
export const ZONAS: Zona[] = [
  { zonaId: "N1", hubId: "HUB-NORTE", fallo: 0.05 },
  { zonaId: "N2", hubId: "HUB-NORTE", fallo: 0.12 },
  { zonaId: "N3", hubId: "HUB-NORTE", fallo: 0.16 },
  { zonaId: "C1", hubId: "HUB-CENTRO", fallo: 0.14 },
  { zonaId: "C2", hubId: "HUB-CENTRO", fallo: 0.2 },
  { zonaId: "C3", hubId: "HUB-CENTRO", fallo: 0.3 },
  { zonaId: "S1", hubId: "HUB-SUR", fallo: 0.1 },
  { zonaId: "S2", hubId: "HUB-SUR", fallo: 0.22 },
  { zonaId: "S3", hubId: "HUB-SUR", fallo: 0.28 },
];