FROM node:22-slim
WORKDIR /app

# 1) dependencias: capa cacheable, solo se rehace si cambia algún package.json
COPY package*.json ./
COPY shared/package.json shared/
COPY simulador/package.json simulador/
COPY proyector/package.json proyector/
COPY notificaciones/package.json notificaciones/
COPY reprogramacion/package.json reprogramacion/
COPY analitica/package.json analitica/
COPY monitor-sla/package.json monitor-sla/
COPY tiempo-hub/package.json tiempo-hub/
COPY web/package.json web/
RUN npm install --no-audit --no-fund

# 2) código
COPY . .