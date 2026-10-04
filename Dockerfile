# Образ для App Platform (Timeweb Cloud) и любого сервера с Docker.
# База живёт отдельно (управляемый PostgreSQL), её адрес приходит в DATABASE_URL.

FROM node:22-bookworm-slim AS base
# openssl нужен движку миграций Prisma
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
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

# При каждом запуске: миграции, недостающие стартовые данные, затем сайт
CMD ["sh", "-c", "npx prisma migrate deploy && npx tsx prisma/seed.ts && npx next start -H 0.0.0.0 -p ${PORT}"]
