import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Параметры TLS для драйвера pg.
 * В строке подключения sslmode оставляем для движка миграций Prisma, а драйверу pg передаём
 * шифрование явно: его собственный разбор sslmode=require требует проверенный сертификат,
 * которого у управляемой базы провайдера в контейнере нет. verify-full включает полную проверку.
 */
export function pgConnectionConfig(databaseUrl: string): { connectionString: string; ssl?: { rejectUnauthorized: boolean } } {
  const url = new URL(databaseUrl);
  const mode = url.searchParams.get("sslmode");
  for (const key of ["sslmode", "sslaccept", "schema", "uselibpqcompat"]) url.searchParams.delete(key);
  const connectionString = url.toString();
  if (!mode || mode === "disable") return { connectionString };
  return { connectionString, ssl: { rejectUnauthorized: mode === "verify-full" } };
}

function createClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL не задан. Запустите npm run setup или задайте переменную в панели хостинга");
  }
  return new PrismaClient({ adapter: new PrismaPg(pgConnectionConfig(databaseUrl)) });
}

function client(): PrismaClient {
  globalForPrisma.prisma ??= createClient();
  return globalForPrisma.prisma;
}

/**
 * Подключение создаётся при первом обращении, а не при импорте.
 * Так сборка (npm run build, Docker) проходит без DATABASE_URL.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const c = client();
    const value = Reflect.get(c, prop, c);
    return typeof value === "function" ? value.bind(c) : value;
  },
});
