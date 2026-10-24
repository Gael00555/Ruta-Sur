import { Kafka, logLevel, type Consumer, type Producer } from "kafkajs";
import { config } from "./config";
import { TOPICS, parseEvent, type AnyEvent } from "./events";
import { crearLogger } from "./logger";

export function createKafka(clientId: string): Kafka {
  return new Kafka({ clientId, brokers: config.kafkaBrokers, logLevel: logLevel.WARN, retry: { retries: 10 } });
}

export async function createProducer(kafka: Kafka): Promise<Producer> {
  const producer = kafka.producer({ allowAutoTopicCreation: false });
  await producer.connect();
  return producer;
}

/** Publica con clave = shipmentId (garantiza orden por envío). */
export async function publish(producer: Producer, topic: string, events: AnyEvent | AnyEvent[]): Promise<void> {
  const lista = Array.isArray(events) ? events : [events];
  if (lista.length === 0) return;
  await producer.send({
    topic,
    acks: -1,
    messages: lista.map((e) => ({ key: e.shipmentId, value: JSON.stringify(e) })),
  });
}

/** Para el simulador: publicar texto crudo (eventos malformados). */
export async function publishRaw(producer: Producer, topic: string, key: string | null, value: string): Promise<void> {
  await producer.send({ topic, acks: -1, messages: [{ key, value }] });
}

export interface Mensaje {
  topic: string;
  partition: number;
  offset: string;
  event: AnyEvent;
}

export interface RunConsumerOpts {
  kafka: Kafka;
  servicio: string;
  groupId: string;
  topics: string[];
  dlqProducer: Producer;
  handler: (m: Mensaje) => Promise<void>;
  fromBeginning?: boolean; // por defecto true: un grupo nuevo lee todo el histórico
}

function shipmentIdDe(raw: string): string | null {
  try {
    const j = JSON.parse(raw);
    return typeof j?.shipmentId === "string" ? j.shipmentId : null;
  } catch {
    return null;
  }
}

/**
 * Consumidor con commit MANUAL: el offset se confirma solo después de que el
 * handler terminó (al-menos-una-vez). Los eventos inválidos van a la DLQ y el
 * consumo continúa. Si el handler lanza, el offset no se confirma y kafkajs reintenta.
 */
export async function runConsumer(opts: RunConsumerOpts): Promise<Consumer> {
  const log = crearLogger(opts.servicio);
  const consumer = opts.kafka.consumer({ groupId: opts.groupId });
  await consumer.connect();
  for (const topic of opts.topics) {
    await consumer.subscribe({ topic, fromBeginning: opts.fromBeginning ?? true });
  }

  await consumer.run({
    autoCommit: false,
    eachMessage: async ({ topic, partition, message }) => {
      const siguiente = (BigInt(message.offset) + 1n).toString();
      const raw = message.value?.toString();

      if (raw) {
        const r = parseEvent(topic, raw);
        if (!r.ok) {
          await publishRaw(
            opts.dlqProducer,
            TOPICS.DLQ,
            shipmentIdDe(raw),
            JSON.stringify({
              motivo: r.motivo,
              topicOrigen: topic,
              particion: partition,
              offset: message.offset,
              consumidor: opts.groupId,
              fallidoEn: new Date().toISOString(),
              raw,
            }),
          );
          log.warn("evento inválido -> DLQ", { topic, partition, offset: message.offset, motivo: r.motivo });
        } else {
          await opts.handler({ topic, partition, offset: message.offset, event: r.event });
          log.info("procesado", { eventId: r.event.eventId, topic, partition, offset: message.offset });
        }
      }
      // (mensajes sin valor = tombstones de topics compactados: se saltean)
      await consumer.commitOffsets([{ topic, partition, offset: siguiente }]);
    },
  });
  return consumer;
}

export function alApagar(fn: () => Promise<void>): void {
  const h = async () => {
    try {
      await fn();
    } finally {
      process.exit(0);
    }
  };
  process.once("SIGINT", h);
  process.once("SIGTERM", h);
}
