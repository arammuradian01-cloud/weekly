import { prisma } from "./db";
import type { Prisma } from "@/generated/prisma/client";

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  if (!row || row.value === null) return fallback;
  return row.value as T;
}

export async function setSetting(key: string, value: Prisma.InputJsonValue): Promise<void> {
  await prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
}

export async function getEpochs(): Promise<{ epoch: number; managementEpoch: number }> {
  const rows = await prisma.setting.findMany({ where: { key: { in: ["auth.epoch", "auth.managementEpoch"] } } });
  const value = (key: string) => {
    const v = rows.find((r) => r.key === key)?.value;
    return typeof v === "number" ? v : 1;
  };
  return { epoch: value("auth.epoch"), managementEpoch: value("auth.managementEpoch") };
}
