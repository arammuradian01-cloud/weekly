# Образ для App Platform (Timeweb Cloud) и любого сервера с Docker.
# База живёт отдельно (управляемый PostgreSQL), её адрес приходит в DATABASE_URL.

FROM node:22-bookworm-slim AS base
# openssl нужен движку миграций Prisma, curl и wget: проверке состояния App Platform изнутри контейнера
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates curl wget \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Сборка: все зависимости, затем убираем инструменты разработки и кэши
FROM base AS build
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
# prisma.config.ts берёт адрес базы отсюда, а prisma generate запускается уже при установке
COPY src/lib/database-url.ts ./src/lib/database-url.ts
RUN npm ci --no-audit --no-fund && npm cache clean --force
COPY . .
RUN npm run build \
  && npm run build:start \
  && npm prune --omit=dev --no-audit --no-fund \
  && npm cache clean --force \
  && rm -rf .next/cache

# Итоговый образ: только то, что нужно для работы
FROM base
COPY --from=build /app /app

ENV NODE_ENV=production \
    PORT=3000 \
    TRUST_PROXY=true \
    BACKUP_ENABLED=false

EXPOSE 3000

# При каждом запуске: подготовка базы (снять зависшие сессии и брошенные миграции, см. src/lib/migrate-prepare.ts),
# миграции не дольше MIGRATE_TIMEOUT секунд (иначе выход с ошибкой и перезапуск платформой, а не молчаливое
# ожидание блокировки), недостающие стартовые данные, затем сайт.
# Сервер приложения маленький (1 ядро, 1 ГБ), поэтому запуск лёгкий: скрипты собраны заранее (npm run build:start),
# без npx и без компиляции TypeScript на старте. Сайту куча Node ограничена NODE_HEAP_MB мегабайтами: без предела
# процесс под нагрузкой дорастал до 460 МБ и вместе с соседним контейнером во время выкладки не помещался в память
ENV MIGRATE_TIMEOUT=600 \
    NODE_HEAP_MB=320
CMD ["sh", "-c", "node dist/start/scripts/migrate-prepare.mjs && timeout -k 10 ${MIGRATE_TIMEOUT} node node_modules/prisma/build/index.js migrate deploy && node dist/start/prisma/seed.mjs && NODE_OPTIONS=\"--max-old-space-size=${NODE_HEAP_MB}\" exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p ${PORT}"]
