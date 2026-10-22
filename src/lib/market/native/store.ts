// Наборы пакета рынка для новой версии раздела (этап 79): разбираются на сервере один раз на версию пакета и живут в
// памяти процесса. Ключ памяти: отпечаток пакета (номер версии и время загрузки), его страница читает из базы на
// каждый запрос одной маленькой выборкой (marketMeta). Отпечаток сменился, значит загрузили новый пакет: наборы
// читаются заново. Загрузка пакета в этом процессе сбрасывает память сразу (resetNativeCache). Готовые модели вкладок
// (плитки, ряды графиков, тексты) тоже хранятся по отпечатку: второй и следующие запросы считать не нужно.
// Из базы читаются только наборы, нужные перенесённым вкладкам, без кода дашборда.

import { prisma } from "@/lib/db";
import { NATIVE_DATASETS, type NativeSets, type Row } from "./rows";

type Entry = { stamp: string; sets: Promise<NativeSets | null>; models: Map<string, unknown> };

let entry: Entry | null = null;

/** Сбросить память: новый пакет загружен */
export function resetNativeCache(): void {
  entry = null;
}

const stampOf = (version: number, uploadedAt: Date) => `${version}-${uploadedAt.getTime()}`;

/** Наборы одним снимком базы вместе с отпечатком пакета, к которому они относятся */
async function readSets(): Promise<{ stamp: string; sets: NativeSets } | null> {
  const [bundle, rows] = await prisma.$transaction(
    [
      prisma.marketBundle.findUnique({ where: { id: "current" }, select: { version: true, uploadedAt: true } }),
      prisma.marketDataset.findMany({ where: { name: { in: [...NATIVE_DATASETS] } }, select: { name: true, rows: true } }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  if (!bundle) return null;
  const sets = Object.fromEntries(NATIVE_DATASETS.map((n) => [n, [] as Row[]])) as NativeSets;
  for (const r of rows) if (Array.isArray(r.rows)) sets[r.name as keyof NativeSets] = r.rows as Row[];
  return { stamp: stampOf(bundle.version, bundle.uploadedAt), sets };
}

function entryFor(stamp: string): Entry {
  if (entry && entry.stamp === stamp) return entry;
  const fresh: Entry = { stamp, sets: Promise.resolve(null), models: new Map() };
  fresh.sets = readSets().then(
    (got) => {
      if (!got) {
        if (entry === fresh) entry = null;
        return null;
      }
      // Пока читали, загрузили другой пакет: в памяти остаётся прочитанное, под своим отпечатком
      if (got.stamp !== stamp && entry === fresh) entry = { stamp: got.stamp, sets: Promise.resolve(got.sets), models: new Map() };
      return got.sets;
    },
    (e: unknown) => {
      if (entry === fresh) entry = null;
      throw e;
    },
  );
  entry = fresh;
  return fresh;
}

/**
 * Модель вкладки по ключу (например, «kasko-overview:top4») для пакета с отпечатком stamp: из памяти или посчитанная
 * build по наборам. null: пакета нет. Доступ проверяет вызывающий
 */
export async function nativeModel<T>(stamp: string, key: string, build: (sets: NativeSets) => T): Promise<T | null> {
  const e = entryFor(stamp);
  const sets = await e.sets;
  if (!sets) return null;
  // Память могла смениться, пока ждали наборы: модель кладётся в ту запись, из которой взяты наборы
  const target = entry && entry.stamp === e.stamp ? entry : e;
  if (target.models.has(key)) return target.models.get(key) as T;
  const model = build(sets);
  target.models.set(key, model);
  return model;
}

/** Для проверок: что сейчас в памяти */
export function nativeCacheState(): { stamp: string; models: string[] } | null {
  return entry ? { stamp: entry.stamp, models: [...entry.models.keys()] } : null;
}
