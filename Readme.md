# RutaSur: logística orientada a eventos

Plataforma de seguimiento de envíos en tiempo real para un operador de última milla ficticio.
Cada cambio de estado de un envío es un evento en Kafka; los servicios reaccionan de forma
independiente y MongoDB guarda vistas derivadas que lee la interfaz en Next.js.

**Stack:** Apache Kafka (KRaft) · Node.js + TypeScript (kafkajs) · MongoDB (replica set de un nodo) · Next.js · Docker Compose.

## Arranque (un solo comando)

Requisito: Docker Desktop corriendo.

```
npm start          # construye y levanta todo
npm run logs       # ver logs de todos los servicios
npm run stop       # apagar (conserva los datos)
npm run reset      # borrar todos los datos y arrancar de cero
```

La primera vez tarda unos minutos (instala dependencias). Para scripts locales
(`verificar`, `snapshot`, `replay:proyector`) hace falta además `npm install` en la raíz.

| Qué | Dónde |
|---|---|
| Torre de control | http://localhost:3000 |
| Analítica | http://localhost:3000/analitica |
| Panel de demo | http://localhost:3000/demo |
| Tracking público | http://localhost:3000/tracking/`<id>` |
| API del simulador | http://localhost:4001 (`/estado`, `POST /escenarios/<nombre>`) |
| MongoDB / Kafka desde el host | `localhost:27018` / `localhost:9094` |

## Arquitectura

Kafka es el único punto de contacto entre servicios: ninguno llama a otro. Next.js solo lee de MongoDB.

| Servicio | Grupo de consumidores | Qué hace |
|---|---|---|
| simulador | no consume | Genera envíos, promesas y estados (semilla fija, reloj acelerado, ruido, escenarios) |
| proyector | `proyector` | Mantiene `envios`, `alertas` y `notificaciones` en MongoDB (CU1) |
| notificaciones | `notificaciones` | Registra avisos ante fallos y alertas (CU2) |
| reprogramacion | `reprogramacion` | Decide el próximo intento tras una entrega fallida (CU2) |
| monitor-sla | `monitor-sla` | Detecta envíos en riesgo y emite alertas (CU3) |
| analitica | `analitica` | Actualiza `metricas_diarias` con incrementos atómicos (CU4) |
| tiempo-hub | `analitica-tiempo-hub` | 4º indicador; demuestra el reprocesamiento (perfil `demo`) |
| web | no consume | Torre de control, detalle, tracking, analítica y demo (SSE sobre change streams) |

Topics (clave de partición: `shipmentId`, 3 particiones): `envios.estados`, `envios.promesas`,
`envios.reprogramaciones`, `alertas.sla`, `notificaciones.enviadas`, `envios.estados.dlq`.

## Guion de la demo (~15 min)

| # | Paso | Qué hacer | Concepto |
|---|---|---|---|
| 1 | Arranque | `npm start`; abrir la torre y ver moverse los contadores | Productor, consumidor |
| 2 | Envío feliz | Panel de demo → *Envío feliz* → abrir su tracking | Proyección (CQRS) |
| 3 | Ausente | *Ausente* → abrir su detalle: notificación, reprogramación y 2.º intento | 3 grupos sobre un mismo evento |
| 4 | Demorado | *Demorado* → en la torre aparece `SIN_SALIDA` (alta) a los ~30 s | Procesamiento con estado y tiempo |
| 5 | Caída de un servicio | `docker compose stop notificaciones`, disparar un *Ausente*, ver el lag crecer, `docker compose start notificaciones` | Aislamiento, offsets, idempotencia |
| 6 | Evento inválido | *Evento inválido* → consumir `envios.estados.dlq` (comando en el panel) | Manejo de errores |
| 7 | Analítica | Abrir `/analitica`, identificar la zona y franja con más fallos | Agregaciones incrementales |
| 8 | Reprocesamiento | `docker compose up -d tiempo-hub` → el 4.º indicador se completa con datos históricos | Retención y replay |

Lag de los grupos:
```
docker exec rutasur-kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --all-groups
```

## Verificación

```
docker compose stop simulador      # el sistema debe estar quieto; esperar ~20 s (lag en 0)
npm run verificar                  # criterios automatizables, contra MongoDB
```

No volver a arrancar el simulador sobre los mismos datos: su reloj vuelve a las 06:00 y queda
desfasado respecto del monitor. Para una demo nueva, usar `npm run reset`.

Reconstrucción de `envios` (debe dar la misma huella antes y después):
```
docker compose stop simulador
npm run snapshot
docker compose stop proyector
npm run replay:proyector           # rebobina offsets y borra vistas + eventos_procesados del proyector
docker compose start proyector     # esperar ~30 s
npm run snapshot
```

Reglas del monitor sin Kafka ni Mongo: `npx tsx monitor-sla/src/probar-reglas.ts`.

## Decisiones de diseño

| Decisión | Elección | Motivo |
|---|---|---|
| Garantía de entrega | Al menos una vez + consumidores idempotentes | Simple y no pierde eventos |
| Idempotencia | `eventos_procesados` (consumidor + eventId único) escrito en la **misma transacción** que el efecto | Un fallo a mitad no deja efecto sin registro |
| Confirmación de offsets | Manual, después de escribir | Un fallo reintenta el evento |
| Eventos derivados | `eventId` determinista (hash del evento de origen) | Un reintento publica el mismo id y el proyector lo descarta |
| Particiones | 3 en todos los topics | Reparto de carga; `estados` y `promesas` co-particionados para el cruce del monitor |
| Formato | JSON validado con zod en cada consumidor | Legible y sin componentes extra |
| Monitor de SLA | Consumidor propio, estado en memoria respaldado en MongoDB | Lógica a la vista, tolera reinicios |
| Reloj del monitor | Mínimo de los `ocurridoEn` máximos por partición | Una partición adelantada no hace correr el tiempo de las demás |
| Evaluación de reglas | Cada minuto simulado, sobre todos los envíos abiertos | Una alerta nace de la ausencia de un evento |
| Tiempo real en la UI | Change streams + SSE, foto completa de la vista | El frontend no depende de Kafka |
| Kafka en local | Un broker KRaft | Un contenedor, sin ZooKeeper |

Supuestos propios: el campo `intento` (1 a 3) viaja en los eventos de estado; `ZONA_INACCESIBLE`
se reprograma como `AUSENTE`; los duplicados y malformados del simulador son mensajes extra, no
reemplazos; cada grupo que lee un evento malformado publica su propia copia en la DLQ.

## Limitaciones conocidas

- El monitor no consume `envios.reprogramaciones`: un envío en `RETENIDO` o `DEVOLUCION` sigue abierto y termina en `VENCIDO`.
- Reiniciar solo el simulador con datos viejos desfasa su reloj respecto del monitor. Para una demo limpia usar `npm run reset`.
- La latencia menor a 2 s se verifica visualmente (los relojes simulado y real no son comparables).
- `web` corre en modo desarrollo dentro de Docker.