import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { databaseUrlFromEnv, pgConnectionConfig } from "./database-url";

export { pgConnectionConfig };

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const databaseUrl = databaseUrlFromEnv();
  if (!databaseUrl) {
    throw new Error("Адрес базы не задан: нужен DATABASE_URL или DB_HOST и DB_PASSWORD. Запустите npm run setup или задайте переменные в панели хостинга");
  }
  return new PrismaClient({ adapter: new PrismaPg(pgConnectionConfig(databaseUrl)) });
}

function client(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

/**
 * Подключение создаётся при первом обращении, а не при импорте.
 * Так сборка (npm run build, Docker) проходит без адреса базы.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
