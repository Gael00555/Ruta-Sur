import { config } from "./config";

// Reloj simulado: avanza `factor` veces más rápido que el real.
export class RelojSimulado {
  private inicioReal = Date.now();
  constructor(private inicioSim: Date, private factor = config.aceleracion) {}

  ahora(): Date {
    return new Date(this.inicioSim.getTime() + (Date.now() - this.inicioReal) * this.factor);
  }
  /** Milisegundos reales que equivalen a `msSim` milisegundos simulados. */
  realDeSim(msSim: number): number {
    return msSim / this.factor;
  }
}
