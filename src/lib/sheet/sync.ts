// Зеркало в Google-таблицу в одну сторону (раздел 5 ТЗ): выгрузка очереди, ночная сверка, пересборка вкладок.
// Таблица никогда не главная: при расхождении всегда побеждает база ресурса.

import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { PROD_SHEET_ID, colLetter, q, type Cell, type Grid, type SheetInfo, type SheetsClient } from "./client";
import { ID_HEADER, LOG_TAB, RENDER, RESOURCE_TABS, SUMMARY_TAB, TASKS_TAB, sameCell, serialMoment, type TabSpec } from "./rows";
import type { Prisma } from "@/generated/prisma/client";

export { PROD_SHEET_ID };
/** Версия разметки вкладок: при смене оформление переделывается один раз, а все строки выгружаются заново.
 * 3: строки данных обычным шрифтом сверху ячейки, ссылка не переносится (живая таблица 06.10 показала жирные строки и даты числами)
 * 4: ширина колонок «Сводки» */
// 5: в колонке «Источник» пометка «(Bord)» у задач из Bord. Новая версия разметки один раз переписывает все строки
export const LAYOUT_VERSION = 5;
export const SUMMARY_MARKER = "Сводка ресурса";
export const ARCHIVE_SUFFIX = " (архив до запуска)";
const PROTECTION = "Вкладка ресурса weekly: правки только через ресурс";
/** Сколько строк хранить во вкладке «Журнал выгрузки» */
const LOG_KEEP = 2000;
/** Сколько записей очереди выгружать за один проход */
const BATCH = 5000;
/** Аренда записи в таблицу: сколько держится, если процесс упал посреди выгрузки */
const LEASE = "10 minutes";

export type SyncOptions = {
  now?: Date;
  serviceEmail?: string | null;
  actor?: { id: string; name: string } | null;
  /** Какая таблица подключена. Передаёт вызывающий: если владелец сменит ссылку во время выгрузки, отметки не перепутаются */
  spreadsheetId?: string;
};
type Diff = { tab: string; id: string; field: string; before: string; after: string };
type Mark = { spreadsheet: string; version: number; email?: string | null };
type Sheets = Map<string, SheetInfo>;

/** Запись в таблицу сейчас идёт в другом процессе сервера (например, во время выкладки новой версии) */
export class SheetBusyError extends Error {
  constructor() {
    super("Выгрузка уже идёт в другом процессе сервера. Попробуйте через минуту");
  }
}

const lastCol = (t: TabSpec) => colLetter(t.columns.length);
const header = (t: TabSpec) => t.columns.map((c) => c.header);
const show = (v: Cell | undefined) => (v === undefined || v === null ? "" : String(v));
const blank = (row: Cell[]) => row.every((v) => show(v).trim() === "");
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

// ---------- Замки ----------

// Внутри процесса: цикл раз в 30 секунд и кнопки страницы не пишут одновременно.
// Замок в globalThis: код синхронизации может оказаться в двух сборках одного процесса (цикл и действия страниц)
const g = globalThis as unknown as { __sheetLock?: Promise<unknown>; __sheetOwner?: string };
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const next = (g.__sheetLock ?? Promise.resolve()).then(fn, fn);
  g.__sheetLock = next.catch(() => undefined);
  return next;
}

/**
 * Между процессами: аренда в базе. Во время выкладки старый и новый контейнер работают одновременно,
 * без аренды оба дописали бы одни и те же строки и удаляли бы строки по устаревшим номерам
 */
async function leased<T>(fn: () => Promise<T>): Promise<T> {
  g.__sheetOwner ??= randomUUID();
  const owner = g.__sheetOwner;
  const got = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "settings" ("key", "value", "updatedAt")
    VALUES ('sheet.lock', jsonb_build_object('owner', ${owner}::text, 'until', now() + ${LEASE}::interval), now())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
    WHERE ("settings"."value"->>'until')::timestamptz < now() OR "settings"."value"->>'owner' = ${owner}::text
    RETURNING "key"`;
  if (!got.length) throw new SheetBusyError();
  try {
    return await fn();
  } finally {
    await prisma.$executeRaw`
      UPDATE "settings" SET "value" = jsonb_build_object('owner', '', 'until', now() - interval '1 second'), "updatedAt" = now()
      WHERE "key" = 'sheet.lock' AND "value"->>'owner' = ${owner}::text`;
  }
}

const guarded = <T>(fn: () => Promise<T>) => exclusive(() => leased(fn));

async function run<T extends { items: number; details?: unknown }>(kind: "push" | "reconcile" | "rebuild", now: Date | undefined, fn: () => Promise<T>): Promise<T> {
  const row = await prisma.sheetRun.create({ data: { kind, startedAt: now ?? new Date() } });
  try {
    const result = await fn();
    await prisma.sheetRun.update({
      where: { id: row.id },
      data: { ok: true, finishedAt: new Date(), items: result.items, details: (result.details ?? undefined) as Prisma.InputJsonValue | undefined },
    });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await prisma.sheetRun.update({ where: { id: row.id }, data: { ok: false, finishedAt: new Date(), error: message.slice(0, 1000) } });
    throw error;
  }
}

// ---------- Отметки: разметка сделана, все строки выгружены ----------

async function target(opts: SyncOptions): Promise<string> {
  return opts.spreadsheetId ?? (await getSetting<string | null>("sheet.spreadsheetId", null)) ?? "";
}

async function marked(key: "sheet.layout" | "sheet.synced", opts: SyncOptions, withEmail = false): Promise<boolean> {
  const m = await getSetting<Mark | null>(key, null);
  if (!m || m.version !== LAYOUT_VERSION || m.spreadsheet !== (await target(opts))) return false;
  return !withEmail || (m.email ?? null) === (opts.serviceEmail ?? null);
}

async function mark(key: "sheet.layout" | "sheet.synced", opts: SyncOptions) {
  await setSetting(key, { spreadsheet: await target(opts), version: LAYOUT_VERSION, email: opts.serviceEmail ?? null });
}

// ---------- Разметка вкладок ----------

type Wanted = { title: string; marker: string; spec?: TabSpec; columns: number };
const WANTED: Wanted[] = [
  ...RESOURCE_TABS.map((t) => ({ title: t.title, marker: ID_HEADER, spec: t, columns: t.columns.length })),
  { title: LOG_TAB.title, marker: LOG_TAB.columns[0]!, columns: LOG_TAB.columns.length },
  { title: SUMMARY_TAB.title, marker: SUMMARY_MARKER, columns: 7 },
];

/** Оформление вкладки. Прежние правила и защиту ресурса снимаем, чтобы при переразметке не было дублей */
function formatRequests(w: Wanted, sheet: SheetInfo, serviceEmail?: string | null): Record<string, unknown>[] {
  const sheetId = sheet.sheetId;
  const req: Record<string, unknown>[] = [];
  for (const p of sheet.protectedRanges ?? []) if (p.description === PROTECTION) req.push({ deleteProtectedRange: { protectedRangeId: p.id } });
  const t = w.spec;
  if (t) for (let i = 0; i < (sheet.conditionalFormats ?? 0); i++) req.push({ deleteConditionalFormatRule: { sheetId, index: 0 } });
  req.push(
    { updateSheetProperties: { properties: { sheetId, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
    { repeatCell: { range: { sheetId, startRowIndex: 0, endRowIndex: 1 }, cell: { userEnteredFormat: { textFormat: { bold: true }, wrapStrategy: "WRAP" } }, fields: "userEnteredFormat(textFormat,wrapStrategy)" } },
    // Строки данных: обычный шрифт, текст переносится, прижат к верху. Без этого строки, вставленные под шапку, берут её жирный шрифт
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 1 },
        cell: { userEnteredFormat: { textFormat: { bold: false }, wrapStrategy: "WRAP", verticalAlignment: "TOP" } },
        fields: "userEnteredFormat.textFormat.bold,userEnteredFormat.wrapStrategy,userEnteredFormat.verticalAlignment",
      },
    },
  );
  const dateFormat = (i: number, kind: "date" | "datetime") => ({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 },
      cell: { userEnteredFormat: { numberFormat: { type: kind === "date" ? "DATE" : "DATE_TIME", pattern: kind === "date" ? "dd.mm.yyyy" : "dd.mm.yyyy hh:mm" } } },
      fields: "userEnteredFormat.numberFormat",
    },
  });
  const width = (i: number, px: number) => ({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: i, endIndex: i + 1 }, properties: { pixelSize: px }, fields: "pixelSize" } });
  if (w.title === LOG_TAB.title) {
    req.push(dateFormat(0, "datetime"), width(0, 130), width(1, 160), width(2, 70), width(3, 320), width(4, 480));
  }
  if (w.title === SUMMARY_TAB.title) req.push(width(0, 220), width(1, 110), width(2, 110), width(3, 110), width(4, 200));
  if (t) {
    const n = t.columns.length;
    // Служебный ID прячем: людям он не нужен, выгрузке нужен
    req.push({ updateDimensionProperties: { range: { sheetId, dimension: "COLUMNS", startIndex: n - 1, endIndex: n }, properties: { hiddenByUser: true }, fields: "hiddenByUser" } });
    t.columns.forEach((c, i) => {
      req.push(width(i, c.width));
      if (c.kind === "date" || c.kind === "datetime") req.push(dateFormat(i, c.kind));
      // Длинная ссылка в узкой колонке не переносится, иначе строка вырастает в пять строк
      if (c.header === "Ссылка") {
        req.push({ repeatCell: { range: { sheetId, startRowIndex: 1, startColumnIndex: i, endColumnIndex: i + 1 }, cell: { userEnteredFormat: { wrapStrategy: "CLIP" } }, fields: "userEnteredFormat.wrapStrategy" } });
      }
    });
    if (t.key === "tasks") {
      // Просроченная задача: вся строка красная, как сейчас в таблице. Считает сама таблица по статусу и сроку.
      // Формула без разделителей аргументов: запятая или точка с запятой зависят от языка таблицы
      const status = colLetter(t.columns.findIndex((c) => c.header === "Статус") + 1);
      const due = colLetter(t.columns.findIndex((c) => c.header === "Срок") + 1);
      req.push({
        addConditionalFormatRule: {
          index: 0,
          rule: {
            ranges: [{ sheetId, startRowIndex: 1, startColumnIndex: 0, endColumnIndex: n }],
            booleanRule: {
              condition: { type: "CUSTOM_FORMULA", values: [{ userEnteredValue: `=(($${status}2="В работе")+($${status}2="Требует уточнений"))*($${due}2<>"")*($${due}2<TODAY())` }] },
              format: { backgroundColor: { red: 0.98, green: 0.85, blue: 0.85 } },
            },
          },
        },
      });
    }
  }
  // Вкладки ресурса меняет только служебный аккаунт. Владелец таблицы править может всегда, его правки вернёт сверка
  if (serviceEmail) req.push({ addProtectedRange: { protectedRange: { range: { sheetId }, description: PROTECTION, warningOnly: false, editors: { users: [serviceEmail] } } } });
  return req;
}

function freeName(base: string, taken: string[]): string {
  const busy = (name: string) => taken.some((t) => same(t, name));
  if (!busy(base)) return base;
  for (let i = 2; ; i++) if (!busy(`${base} ${i}`)) return `${base} ${i}`;
}

/**
 * Вкладки ресурса есть и размечены. Чужую вкладку с тем же именем (старые «Задачи» со сводкой сверху)
 * переименовываем в «… (архив до запуска)» и заводим свою. Остальные вкладки таблицы не трогаем.
 * Имена вкладок Google сравнивает без учёта регистра: «weekly» и «Weekly» для него одно имя.
 * Если разметка уже сделана и все вкладки на месте, шапки не читаем: это экономит обращения к Google каждые 30 секунд
 */
export async function ensureLayout(client: SheetsClient, opts: SyncOptions = {}, { refreshSummary = false } = {}): Promise<Sheets> {
  const current = await marked("sheet.layout", opts, true);
  let sheets = await client.sheets();
  const fresh = new Set<string>();
  const exact = (title: string) => sheets.find((s) => s.title === title);
  if (!current || WANTED.some((w) => !exact(w.title))) {
    const renames: Record<string, unknown>[] = [];
    const names = sheets.map((s) => s.title);
    for (const w of WANTED) {
      const existing = sheets.find((s) => same(s.title, w.title));
      if (!existing) continue;
      // Целые строки, а не A1:Z3: у вкладки может быть меньше 26 колонок, и Google отказал бы в чтении за пределами сетки
      const head = await client.getValues(`${q(existing.title)}!1:3`);
      const empty = !head.some((row) => !blank(row));
      if (empty || (head[0] ?? []).map(show).includes(w.marker)) {
        // Своя вкладка или пустая: берём себе, имя возвращаем точное
        if (empty) fresh.add(w.title);
        if (existing.title !== w.title) renames.push({ updateSheetProperties: { properties: { sheetId: existing.sheetId, title: w.title }, fields: "title" } });
        continue;
      }
      const name = freeName(`${w.title}${ARCHIVE_SUFFIX}`, names);
      names.push(name);
      renames.push({ updateSheetProperties: { properties: { sheetId: existing.sheetId, title: name }, fields: "title" } });
    }
    await client.batchUpdate(renames);
    if (renames.length) sheets = await client.sheets();
    const adds = WANTED.filter((w) => !sheets.some((s) => same(s.title, w.title)));
    await client.batchUpdate(adds.map((w) => ({ addSheet: { properties: { title: w.title } } })));
    if (adds.length) sheets = await client.sheets();
    for (const w of adds) fresh.add(w.title);
  }

  // Колонок может не хватать, если вкладку заводили руками
  const widen = WANTED.flatMap((w) => {
    const s = exact(w.title)!;
    return s.columnCount !== undefined && s.columnCount < w.columns ? [{ appendDimension: { sheetId: s.sheetId, dimension: "COLUMNS", length: w.columns - s.columnCount } }] : [];
  });
  await client.batchUpdate(widen);
  if (widen.length) sheets = await client.sheets();

  const heads = WANTED.filter((w) => w.spec && fresh.has(w.title)).map((w) => ({ range: `${q(w.title)}!A1:${lastCol(w.spec!)}1`, values: [header(w.spec!)] }));
  if (fresh.has(LOG_TAB.title)) heads.push({ range: `${q(LOG_TAB.title)}!A1:E1`, values: [LOG_TAB.columns] });
  await client.setValues(heads);
  if (fresh.has(SUMMARY_TAB.title) || refreshSummary || !current) await writeSummary(client, exact(SUMMARY_TAB.title)!);

  // Оформление и защита: новым вкладкам всегда, всем вкладкам один раз на таблицу, версию разметки и служебный аккаунт
  const toFormat = WANTED.filter((w) => !current || fresh.has(w.title));
  if (toFormat.length) await client.batchUpdate(toFormat.flatMap((w) => formatRequests(w, exact(w.title)!, opts.serviceEmail)));
  if (!current) await mark("sheet.layout", opts);
  return new Map(sheets.map((s) => [s.title, s]));
}

/** Сетка вкладки вмещает столько строк: values.update за её пределы Google не пишет */
async function ensureRows(client: SheetsClient, sheet: SheetInfo, rows: number) {
  const have = sheet.rowCount;
  if (have === undefined || have >= rows) return;
  await client.batchUpdate([{ appendDimension: { sheetId: sheet.sheetId, dimension: "ROWS", length: rows - have + 100 } }]);
  sheet.rowCount = rows + 100;
}

/**
 * «Сводка» по лидерам поверх вкладки «Задачи», как сводка над старой таблицей.
 * Имена пишутся как есть (RAW): имя, похожее на формулу или дату, не превратится в формулу или дату.
 * Формулы на SUMPRODUCT с одним аргументом: им не важно, запятая или точка с запятой разделяют аргументы в языке таблицы
 */
async function writeSummary(client: SheetsClient, sheet: SheetInfo) {
  const people = await prisma.person.findMany({ where: { active: true, role: { not: "OBSERVER" } }, orderBy: [{ sortOrder: "asc" }, { fullName: "asc" }] });
  const T = q(TASKS_TAB.title);
  const col = (h: string) => {
    const c = colLetter(TASKS_TAB.columns.findIndex((x) => x.header === h) + 1);
    return `${T}!$${c}$2:$${c}`;
  };
  const [owner, status, state, due] = [col("Ответственный"), col("Статус"), col("Состояние"), col("Срок")];
  const open = `((${status}="В работе")+(${status}="Требует уточнений"))`;
  const formulas: Grid = people.map((_, i) => {
    const who = `(${owner}=$A${i + 2})`;
    return [
      `=SUMPRODUCT(${who}*1)`,
      `=SUMPRODUCT(${who}*${open})`,
      `=SUMPRODUCT(${who}*${open}*(${due}<>"")*(${due}<TODAY()))`,
      `=SUMPRODUCT(${who}*${open}*((${state}="Есть риск")+(${state}="Заблокирована")))`,
    ];
  });
  const S = q(SUMMARY_TAB.title);
  await ensureRows(client, sheet, people.length + 1);
  await client.clear(`${S}!A1:G`);
  await client.setValues([
    { range: `${S}!A1:G1`, values: [["Ответственный", "Всего задач", "Открыто", "Просрочено", "Есть риск или заблокированы", "", SUMMARY_MARKER]] },
    ...(people.length ? [{ range: `${S}!A2:A${people.length + 1}`, values: people.map((p) => [p.fullName]) }] : []),
  ]);
  if (people.length) await client.setFormulas(`${S}!B2:E${people.length + 1}`, formulas);
}

// ---------- Запись строк ----------

type Plan = { updates: { range: string; values: Grid }[]; deletes: number[]; appends: Grid };

/** Где строки с ID: номер строки таблицы с единицы. Дубли ID тоже видны */
async function idRows(client: SheetsClient, t: TabSpec): Promise<Map<string, number[]>> {
  const col = lastCol(t);
  const values = await client.getValues(`${q(t.title)}!${col}2:${col}`);
  const map = new Map<string, number[]>();
  values.forEach((row, i) => {
    const id = show(row[0]).trim();
    if (!id) return;
    map.set(id, [...(map.get(id) ?? []), i + 2]);
  });
  return map;
}

function planFor(t: TabSpec, keys: Iterable<string>, desired: Map<string, Cell[]>, where: Map<string, number[]>): Plan {
  const plan: Plan = { updates: [], deletes: [], appends: [] };
  for (const key of keys) {
    const row = desired.get(key);
    const at = where.get(key) ?? [];
    if (row && at.length) {
      plan.updates.push({ range: `${q(t.title)}!A${at[0]}:${lastCol(t)}${at[0]}`, values: [row] });
      plan.deletes.push(...at.slice(1));
    } else if (row) plan.appends.push(row);
    else plan.deletes.push(...at);
  }
  return plan;
}

async function apply(client: SheetsClient, t: TabSpec, sheet: SheetInfo, plan: Plan): Promise<number> {
  await client.setValues(plan.updates);
  // Снизу вверх, чтобы номера строк выше не сдвигались
  const rows = [...new Set(plan.deletes)].sort((a, b) => b - a);
  if (rows.length) {
    // Google не даёт удалить все строки под закреплённой шапкой: если сетка кончается на последней строке данных, сначала добавим пустые
    if (sheet.rowCount !== undefined && sheet.rowCount - rows.length <= 1) await ensureRows(client, sheet, sheet.rowCount + 1);
    await client.batchUpdate(rows.map((r) => ({ deleteDimension: { range: { sheetId: sheet.sheetId, dimension: "ROWS", startIndex: r - 1, endIndex: r } } })));
    if (sheet.rowCount !== undefined) sheet.rowCount -= rows.length;
  }
  // Дописывание идёт в уже размеченные пустые строки, сетка растёт только в самом конце: размер сетки здесь не прибавляем,
  // заниженная оценка безопасна (лишний раз добавим пустые строки), завышенная нет
  await client.append(t.title, plan.appends);
  return plan.updates.length + rows.length + plan.appends.length;
}

async function logRow(client: SheetsClient, what: string, items: number, result: string, details = "", now = new Date()) {
  await client.append(LOG_TAB.title, [[serialMoment(now), what, items, result, details.slice(0, 1000)]]);
}

async function dropOutbox(ids: bigint[]) {
  for (let i = 0; i < ids.length; i += 1000) await prisma.sheetOutbox.deleteMany({ where: { id: { in: ids.slice(i, i + 1000) } } });
}

// ---------- Выгрузка очереди ----------

export type PushResult = { items: number; queued: number; full: boolean };

async function pushBody(client: SheetsClient, opts: SyncOptions): Promise<PushResult> {
  const rows = await prisma.sheetOutbox.findMany({ orderBy: { id: "asc" }, take: BATCH, select: { id: true, kind: true, key: true } });
  // Все строки выгружаются, пока полная выгрузка в эту таблицу не прошла до конца: сбой посередине первой выгрузки не оставит вкладки недописанными
  const synced = await marked("sheet.synced", opts);
  if (!rows.length && synced) return { items: 0, queued: 0, full: false };
  const full = !synced || rows.length >= BATCH || rows.some((r) => r.kind === "all");
  const summary = full || rows.some((r) => r.kind === "summary");
  const keys = { tasks: new Set<string>(), comments: new Set<string>(), weekly: new Set<string>() };
  for (const r of rows) {
    if (r.kind === "task") keys.tasks.add(r.key);
    if (r.kind === "comment") keys.comments.add(r.key);
    if (r.kind === "entry") keys.weekly.add(r.key);
  }
  const result = await run("push", opts.now, async () => {
    const sheets = await ensureLayout(client, opts, { refreshSummary: summary });
    let items = 0;
    for (const t of RESOURCE_TABS) {
      const k = keys[t.key];
      if (!full && !k.size) continue;
      const desired = await RENDER[t.key](full ? null : [...k]);
      const where = await idRows(client, t);
      const scope = full ? new Set([...desired.keys(), ...where.keys()]) : k;
      items += await apply(client, t, sheets.get(t.title)!, planFor(t, scope, desired, where));
    }
    if (items) await logRow(client, full ? "Выгрузка всех строк" : "Выгрузка", items, "готово", "", opts.now);
    if (full) await mark("sheet.synced", opts);
    return { items, queued: rows.length, full };
  });
  await dropOutbox(rows.map((r) => r.id));
  return result;
}

/**
 * Выгрузить то, что накопилось в очереди: строки ищутся по служебному ID, недостающие дописываются, лишние удаляются.
 * Из очереди удаляются только прочитанные записи и только после успешной записи: при недоступности Google ничего не теряется,
 * а правка, сделанная во время выгрузки, уйдёт следующим проходом
 */
export function pushChanges(client: SheetsClient, opts: SyncOptions = {}): Promise<PushResult> {
  return guarded(() => pushBody(client, opts));
}

// ---------- Сверка ----------

export type ReconcileResult = { items: number; details: { diffs: Diff[]; removed: { tab: string; row: string }[]; restored: { tab: string; id: string }[] } };

/**
 * Сверка: вкладки ресурса против базы. Ручную правку возвращаем и пишем в журнал, лишние строки убираем,
 * пропавшие дописываем, пустые строки внутри вкладки схлопываем. Шапку восстанавливаем, если её поменяли.
 * Сначала выгружаем очередь: правка в ресурсе, которая ещё не ушла, не должна попасть в журнал как ручная правка в таблице
 */
export function reconcile(client: SheetsClient, opts: SyncOptions = {}): Promise<ReconcileResult> {
  return guarded(async () => {
    await pushBody(client, opts);
    const fence = (await prisma.sheetOutbox.aggregate({ _max: { id: true } }))._max.id ?? BigInt(0);
    return run("reconcile", opts.now, async () => {
      const sheets = await ensureLayout(client, opts, { refreshSummary: true });
      const diffs: Diff[] = [];
      const removed: { tab: string; row: string }[] = [];
      const restored: { tab: string; id: string }[] = [];
      let items = 0;
      for (const t of RESOURCE_TABS) {
        const sheet = await client.getValues(`${q(t.title)}!A1:${lastCol(t)}`);
        const head = header(t);
        if (head.some((h, i) => show(sheet[0]?.[i]) !== h)) {
          await client.setValues([{ range: `${q(t.title)}!A1:${lastCol(t)}1`, values: [head] }]);
          diffs.push({ tab: t.title, id: "шапка", field: "Шапка вкладки", before: (sheet[0] ?? []).map(show).join(" | "), after: head.join(" | ") });
          items += 1;
        }
        const desired = await RENDER[t.key](null);
        const plan: Plan = { updates: [], deletes: [], appends: [] };
        const seen = new Set<string>();
        sheet.slice(1).forEach((row, i) => {
          const rowNo = i + 2;
          if (blank(row)) {
            // Пустая строка внутри вкладки: убираем молча, иначе дописывание строк в конец может попасть в дыру
            plan.deletes.push(rowNo);
            return;
          }
          const id = show(row[t.columns.length - 1]).trim();
          const want = id ? desired.get(id) : undefined;
          if (!want || seen.has(id)) {
            plan.deletes.push(rowNo);
            removed.push({ tab: t.title, row: row.slice(0, 3).map(show).join(" | ") });
            return;
          }
          seen.add(id);
          if (want.every((v, j) => sameCell(row[j], v))) return;
          want.forEach((v, j) => {
            if (!sameCell(row[j], v)) diffs.push({ tab: t.title, id, field: t.columns[j]!.header, before: show(row[j]), after: show(v) });
          });
          plan.updates.push({ range: `${q(t.title)}!A${rowNo}:${lastCol(t)}${rowNo}`, values: [want] });
        });
        for (const [id, row] of desired) {
          if (!seen.has(id)) {
            plan.appends.push(row);
            restored.push({ tab: t.title, id });
          }
        }
        items += await apply(client, t, sheets.get(t.title)!, plan);
      }

      // Правки ресурса, сделанные, пока шла сверка: таблицу мы уже поправили, но в журнал как ручную правку их не пишем
      const late = await prisma.sheetOutbox.findMany({ where: { id: { gt: fence } }, select: { kind: true, key: true } });
      const lateAll = late.some((r) => r.kind === "all");
      const lateKey = new Set(late.map((r) => `${r.kind === "task" ? TASKS_TAB.title : r.kind === "comment" ? "Комментарии к задачам" : "Weekly"}/${r.key}`));
      const fromSheet = (tab: string, id: string) => !lateAll && !lateKey.has(`${tab}/${id}`);
      const logDiffs = diffs.filter((d) => d.id === "шапка" || fromSheet(d.tab, d.id));
      const logRestored = restored.filter((r) => fromSheet(r.tab, r.id));

      // Каждая возвращённая правка в журнале ресурса: что было в таблице и что вернули
      const actor = { action: "sync.revert", source: "SYSTEM" as const, actorName: "Сверка с таблицей", entity: "sheet" };
      if (logDiffs.length || removed.length || logRestored.length) {
        await prisma.auditLog.createMany({
          data: [
            ...logDiffs.map((d) => ({ ...actor, entityId: `${d.tab}/${d.id}`, field: `${d.tab}: ${d.field}`, before: d.before, after: d.after })),
            ...removed.map((r) => ({ ...actor, entityId: r.tab, field: `${r.tab}: лишняя строка убрана`, before: r.row })),
            ...logRestored.map((r) => ({ ...actor, entityId: `${r.tab}/${r.id}`, field: `${r.tab}: пропавшая строка возвращена`, after: r.id })),
          ],
        });
      }
      await trimLog(client, sheets.get(LOG_TAB.title)!);
      // История запусков на странице «Синхронизация»: хватает месяца
      await prisma.sheetRun.deleteMany({ where: { startedAt: { lt: new Date((opts.now ?? new Date()).getTime() - 31 * 86_400_000) } } });
      const fixed = logDiffs.length + removed.length + logRestored.length;
      const summary = fixed ? `исправлено ячеек ${logDiffs.length}, убрано строк ${removed.length}, возвращено ${logRestored.length}` : "расхождений нет";
      await logRow(client, "Сверка", items, summary, logDiffs.slice(0, 5).map((d) => `${d.tab} ${d.id}: ${d.field}`).join("; "), opts.now);
      return { items, details: { diffs: logDiffs.slice(0, 500), removed: removed.slice(0, 200), restored: logRestored.slice(0, 200) } };
    });
  });
}

/** Во вкладке «Журнал выгрузки» оставляем последние строки, старые удаляем */
async function trimLog(client: SheetsClient, sheet: SheetInfo) {
  const values = await client.getValues(`${q(LOG_TAB.title)}!A2:A`);
  const extra = values.length - LOG_KEEP;
  if (extra > 0) await client.batchUpdate([{ deleteDimension: { range: { sheetId: sheet.sheetId, dimension: "ROWS", startIndex: 1, endIndex: 1 + extra } } }]);
}

// ---------- Пересборка ----------

/**
 * «Пересобрать вкладки»: записать все строки заново из базы поверх старых и убрать хвост.
 * Пишем по адресам, а не дописыванием: так результат не зависит от дыр в старых данных
 */
export function rebuild(client: SheetsClient, opts: SyncOptions = {}): Promise<{ items: number }> {
  return guarded(() =>
    run("rebuild", opts.now, async () => {
      // Очередь читаем до чтения базы: правка, сделанная во время пересборки, останется в очереди
      const pending = await prisma.sheetOutbox.findMany({ select: { id: true } });
      const sheets = await ensureLayout(client, opts, { refreshSummary: true });
      let items = 0;
      for (const t of RESOURCE_TABS) {
        const info = sheets.get(t.title)!;
        const old = (await client.getValues(`${q(t.title)}!A1:${lastCol(t)}`)).length;
        const desired = [...(await RENDER[t.key](null)).values()];
        // Запас строк сверх старых данных: хвост удалится, а под шапкой останется хотя бы одна строка
        await ensureRows(client, info, Math.max(desired.length + 2, old + 1));
        await client.setValues([{ range: `${q(t.title)}!A1:${lastCol(t)}${desired.length + 1}`, values: [header(t), ...desired] }]);
        if (old > desired.length + 1) {
          // Хвост старых строк
          await client.batchUpdate([{ deleteDimension: { range: { sheetId: info.sheetId, dimension: "ROWS", startIndex: desired.length + 1, endIndex: old } } }]);
        }
        items += desired.length;
      }
      await dropOutbox(pending.map((p) => p.id));
      await mark("sheet.synced", opts);
      await logRow(client, "Пересборка", items, "готово", "", opts.now);
      if (opts.actor) {
        await prisma.auditLog.create({ data: { action: "sync.rebuild", actorId: opts.actor.id, actorName: opts.actor.name, entity: "sheet", entityId: "all", field: "Вкладки ресурса пересобраны", after: `строк ${items}` } });
      }
      return { items };
    }),
  );
}
