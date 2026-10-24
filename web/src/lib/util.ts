export const plain = <T>(x: unknown): T => JSON.parse(JSON.stringify(x)) as T;

// formato fijo (igual en servidor y cliente, sin zona horaria): "03-02 11:04"
export const fmt = (iso?: string | null) => (iso ? iso.slice(5, 16).replace("T", " ") : "—");

export const ESTADOS = ["CREADO", "INGRESADO_HUB", "CLASIFICADO", "EN_REPARTO", "ENTREGADO", "ENTREGA_FALLIDA"];
export const RANGO: Record<string, number> = { CRITICA: 0, ALTA: 1, MEDIA: 2 };