#!/bin/bash
set -e

KT=/opt/kafka/bin/kafka-topics.sh
BS=kafka:9092
D30=2592000000   # 30 días en ms
D7=604800000     # 7 días en ms

# Las 3 particiones en todos los topics: envios.estados y envios.promesas
# deben estar co-particionados para que el monitor de SLA vea ambos
# streams del mismo envío en la misma instancia.
create() {
  $KT --bootstrap-server $BS --create --if-not-exists \
      --topic "$1" --partitions 3 --replication-factor 1 --config "$2"
}

create envios.estados           retention.ms=$D30
create envios.promesas          cleanup.policy=compact
create envios.reprogramaciones  retention.ms=$D30
create alertas.sla              retention.ms=$D7
create notificaciones.enviadas  retention.ms=$D7
create envios.estados.dlq       retention.ms=$D30

echo "Topics listos:"
$KT --bootstrap-server $BS --list