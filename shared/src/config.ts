export const config = {
  kafkaBrokers: (process.env.KAFKA_BROKERS ?? "localhost:9094").split(","),
  mongoUri: process.env.MONGO_URI ?? "mongodb://localhost:27018/?directConnection=true",
  mongoDb: process.env.MONGO_DB ?? "rutasur",
  // 1 hora simulada = 30 s reales  ->  factor 120
  aceleracion: Number(process.env.ACELERACION ?? 120),
};
