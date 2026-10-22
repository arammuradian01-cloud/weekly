// Импорт наполнения (этап 67). Владелец при личном входе в режиме управления загружает пакет: сначала предпросмотр
// (что добавится, обновится, пропустится, кого и каких команд не нашли, что не загрузится и почему), потом загрузка
// одной транзакцией.
//
// Правила:
// - загрузка добавляет и обновляет записи с тем же внешним ключом; стирает только решения, которые сама ставила и
//   которые пакет перечислил в remove (этап 67г);
// - задачи ставятся через службу задач с её правилами (автор: тот, кто загружает), цели через службу целей,
//   связь задачи с целью через ту же проверку, что в карточке;
// - повторная загрузка того же пакета ничего не меняет: ключ и отпечаток записи совпадают;
// - у каждого поля в ключе хранится база: значение, которое загрузка оставила в ресурсе. Поле, которое в ресурсе
//   поменяли после загрузки (не совпадает с базой), загрузка не трогает и базу не сдвигает: правка живёт и после
//   следующих загрузок. Поле, которое загрузка не смогла записать, тоже остаётся с прежней базой. Рядом с базой в ключе
//   лежит сама запись пакета (record): по ней видно, что пакет поменял в полях, которые загрузка не пишет (ответственный,
//   команда, дата решения), и что у связи поменялись только уверенность или причина;
// - у цели из борда лидера с тем же номером загрузке принадлежат только поля, которые она заполнила пустыми: остальные
//   поля борда она не перезаписывает. С пометкой replace цель приводится к пакету целиком и дальше вся принадлежит
//   загрузке. Цель с source leader-board:<вкладка> заводится как цель борда;
// - задачу, поставленную в ресурсе до импорта, пакет подхватывает по номеру и названию (adopt): загрузке принадлежат её
//   статус, итог, «Где сейчас» и срок; название, «что нужно сделать» и ответственного ведут в ресурсе. Закрытую задачу
//   загрузка не открывает, срок по умолчанию поверх её срока не ставит, дублем её не считает. Кадровый фильтр тот же;
// - план считается один раз и для предпросмотра, и для загрузки: что предпросмотр обещал, то загрузка и делает. Правила
//   служб, которые иначе уронили бы загрузку, проверяются в плане: такая запись пропускается с причиной;
// - номера новых задач берутся заранее короткой транзакцией, лишние возвращаются;
// - план считается без блокировок, потом запираются только строки, которые загрузка запишет (FOR UPDATE, по порядку
//   id), и план считается заново по ним. Правка такой строки во время загрузки ждёт её конца и может не дождаться
//   (у служб ресурса своё время ожидания); то, что в ресурсе уже так, загрузка считает без изменений. Взаимную
//   блокировку Postgres снимает: загрузка откатывается с понятной причиной, её повторяют;
// - запись, которая уже есть в ресурсе (подхват без правок, цель с тем же номером без новых полей, задача уже с этой
//   целью), привязывается к ресурсу: загрузка только запоминает её ключ;
// - любая ошибка правила при загрузке откатывает всё: база остаётся как была, владелец видит запись и причину;
// - этап 67г: крупные инициативы. Новая встаёт с делением и заметкой из пакета, закрытая сразу закрывается с итогом.
//   Поля уже загруженной инициативы (название, зачем, продукт, ответственный, команда, цель, деление, заметка, итог)
//   идут по тем же трём значениям, что у задач: правку в ресурсе загрузка не затирает. Событий «Мне» о загруженных
//   инициативах нет, как и о старых решениях: ответственных назначили не сегодня, а в рабочем файле;
// - этап 67г: пакет может стереть решения, которые ставила загрузка (remove по ключу). Решение, поставленное не загрузкой,
//   и решение, текст которого правили в ресурсе, не стираются. Стёртое решение остаётся в журнале с текстом;
// - этап 67г: weekly для CEO за прошедшие недели. Пишется в отчёт CEO недели блоками (каждый помечен правленым руками:
//   живые цифры его не пересобирают). Отчёт, который уже есть в ресурсе и не загрузкой поставлен, отправленный CEO и
//   правленный после загрузки, загрузка не трогает.

import { prisma } from "@/lib/db";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { TOP_TEAM, ancestorsOf, loadTeamNodes, type TeamNode } from "@/lib/org/scope";
import { NameIndex, normName } from "@/lib/bord/names";
import { TaskRuleError, changeStatus, createTaskIn, editTask, releaseTaskNumbers, reserveTaskNumbers, transferDue, updateWhere, type Actor } from "@/lib/tasks/service";
import { approvalRule } from "@/lib/tasks/approval";
import { createGoal, linkTaskGoal, updateGoal } from "@/lib/goals/service";
import { goalFits } from "@/lib/goals/personal";
import { quarterOf } from "@/lib/goals/parse";
import { dbDate, isIsoDate, isoFromDbDate, moscowToday } from "@/lib/tasks/dates";
import { statusCode } from "@/lib/tasks/codes";
import { addDays, diffDays, formatLong, plural, toCalendar, type IsoDate } from "@/domain/dates";
import { moscowDateTime } from "@/lib/week";
import { sameTask } from "@/lib/meeting/parse-types";
import { cleanText, personnelExclusions, recordHash, shortText as short, surnameStems, type ContentPackage, type PackageDecision, type PackageGoal, type PackageCeoReport, type PackageInitiative, type PackageLink, type PackageRemoval, type PackageTask } from "./package";
import { ensureWeek } from "@/lib/weekly/service";
import { cleanMeetings } from "@/lib/ceo/text";
import { blocksToLegacy, cleanBlocks, standardOf, type ReportBlock } from "@/lib/weekly-blocks/types";
import { SOFT_MAX as INITIATIVES_SOFT_MAX } from "@/lib/initiatives/rules";

type Tx = Prisma.TransactionClient;
type Db = PrismaClient | Tx;

export const IMPORT_ONLY = "Наполнение загружает владелец при личном входе в режиме управления";
export const ALL_LEADERS_NAME = "Все лидеры";
/** Причина переноса срока, когда пакет поменял срок задачи после прошлой загрузки */
export const IMPORT_TRANSFER_REASON = "Срок обновлён из пакета наполнения";
const UNCHANGED = "без изменений";
/** Запись уже загружена, а пакет поменял только то, что загрузка не пишет или что правили в ресурсе */
const ONLY_OTHER = "изменились только поля, которые загрузка не меняет или которые правили в ресурсе";

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export function canImportContent(actor: Pick<Actor, "role" | "management" | "via">): boolean {
  return actor.role === "OWNER" && actor.management === "OWNER" && !!actor.via && actor.via !== "TEAM";
}

/** Срок по умолчанию для открытых задач, у которых срок в пакете уже прошёл: через две недели после загрузки */
export const STALE_DUE_DAYS = 14;
/** Дальше этого сроки двух задач с похожим названием считаются разными задачами, а не дублем */
const DUPLICATE_DUE_DAYS = 21;

export type ImportOptions = {
  /** Загружать все вероятные дубли того, что уже есть в ресурсе (по умолчанию они пропускаются) */
  duplicates?: boolean;
  /** Загружать выбранные дубли: «task/ключ» и «decision/ключ» */
  duplicateKeys?: string[];
  /** Срок для открытых задач, у которых срок в пакете уже прошёл. По умолчанию сегодня плюс 14 дней */
  staleDue?: IsoDate;
};

/** Вероятный дубль в предпросмотре: id «task/ключ» или «decision/ключ», on: загрузится */
export type DuplicateLine = { id: string; what: string; text: string; on: boolean };

export type ImportCounts = { add: number; update: number; skip: number };
export type ImportLine = { what: string; text: string };
export type ImportPreview = {
  title: string | null;
  tasks: ImportCounts;
  decisions: ImportCounts;
  goals: ImportCounts;
  links: ImportCounts;
  /** ФИО из пакета, которых нет в ресурсе или которые выключены */
  missingPeople: string[];
  /** Команды из пакета, которых нет в ресурсе */
  missingTeams: string[];
  /** Не загрузятся, пока их не исправят в пакете: кадровые сведения, решение без команды, правило службы */
  errors: ImportLine[];
  /** Загрузятся, но не так, как в пакете: цель выше не подошла, у подхваченной задачи другой ответственный */
  warnings: ImportLine[];
  /** Крупные инициативы (этап 67г) */
  initiatives: ImportCounts;
  /** Стирание решений, которые ставила загрузка (этап 67г): сколько сотрётся и сколько пропустится */
  removals: { remove: number; skip: number };
  /** Weekly для CEO за прошедшие недели (этап 67г) */
  ceoReports: ImportCounts;
  /** Привяжутся к ресурсу: запись уже есть в ресурсе и совпадает с пакетом, загрузка только запомнит её ключ */
  bound: ImportLine[];
  /** Вероятные дубли того, что уже есть в ресурсе: по умолчанию пропускаются, по одному или все можно включить */
  duplicates: DuplicateLine[];
  /** Загрузка возьмёт все вероятные дубли */
  withDuplicates: boolean;
  /** Открытые задачи, у которых срок в пакете уже прошёл: встанут со сроком staleDue */
  staleTasks: { key: string; title: string; due: IsoDate }[];
  /** Срок для задач без актуального срока: выбранный владельцем или сегодня плюс 14 дней */
  staleDue: IsoDate;
  /** Что пропустится и почему, и что обновится не целиком */
  notes: ImportLine[];
  /** Сколько человек узнают о новых открытых задачах в «Мне»: ответственные, соисполнители, согласующие */
  notified: number;
};
export type ImportResult = ImportPreview & { applied: { tasks: number[]; goals: number; decisions: number; links: number; initiatives: number; removed: number; ceoReports: number } };

type Kind = "task" | "decision" | "goal" | "link" | "initiative" | "ceo";
type KeyRow = { kind: string; key: string; entityId: string; hash: string; payload: Prisma.JsonValue };
type Person = { id: string; slug: string; fullName: string; shortName: string; active: boolean; role: string };

/** Справочники для сопоставления: люди, команды, направления, источники, уже загруженные ключи, что есть в ресурсе */
type Ctx = {
  db: Db;
  actor: Actor;
  opts: ImportOptions;
  today: IsoDate;
  people: Person[];
  index: NameIndex;
  nodes: TeamNode[];
  directions: Set<string>;
  /** Коды продуктов и их id в справочнике: продукт инициативы хранится ссылкой */
  directionIds: Map<string, string>;
  sources: Set<string>;
  keys: Map<string, KeyRow>;
  /** Задачи, у которых уже есть ключ пакета: id задачи и ключ (одну задачу ресурса подхватывает один ключ) */
  taskKeys: Map<string, string>;
  /** Записи с кадровыми сведениями: подпись без текста записи и причина */
  excluded: Map<string, { what: string; text: string }>;
  /** Срок для открытых задач со сроком в прошлом */
  staleDue: IsoDate;
  /** Задачи ресурса для поиска дублей: owner это id ответственного или «all» */
  tasks: { number: number; title: string; owner: string | null; due: IsoDate }[];
  /** Решения ресурса за даты пакета для поиска дублей */
  decisions: { teamId: string; date: IsoDate; text: string }[];
  /** Открытые инициативы ресурса для поиска дублей и счёта открытых */
  initiatives: { id: string; title: string }[];
  /** Согласующий человека из другого департамента для того, кто загружает (кеш на одну загрузку) */
  approvers: Map<string, string | null>;
  missingPeople: Set<string>;
  missingTeams: Set<string>;
  notes: ImportLine[];
  warnings: ImportLine[];
};

const key = (kind: Kind, k: string) => `${kind}/${k}`;

/** Как назвать запись пакета в пояснении: запись с кадровыми сведениями только видом, номером и ключом, без её текста */
function nameOf(ctx: Ctx, kind: "task" | "goal", k: string, title: string): string {
  const hr = ctx.excluded.get(key(kind, k));
  if (hr) return hr.what.charAt(0).toLowerCase() + hr.what.slice(1);
  return `${kind === "task" ? "задача" : "цель"} «${short(title)}»`;
}

async function context(db: Db, actor: Actor, pkg: ContentPackage, opts: ImportOptions): Promise<Ctx> {
  const dates = [...new Set(pkg.decisions.map((d) => d.date).filter(Boolean))];
  // По очереди: внутри транзакции у клиента базы один запрос за раз
  const people = await db.person.findMany({ select: { id: true, slug: true, fullName: true, shortName: true, active: true, role: true } });
  const nodes = await loadTeamNodes(db);
  const dict = await db.dictionaryItem.findMany({ where: { kind: { in: ["DIRECTION", "TASK_SOURCE"] }, active: true }, select: { id: true, kind: true, code: true } });
  const keys = await db.contentImportKey.findMany();
  const tasks = await db.task.findMany({ where: { archivedAt: null }, select: { number: true, title: true, ownerId: true, ownerAll: true, due: true } });
  const decisions = dates.length ? await db.decision.findMany({ where: { date: { in: dates.map(dbDate) } }, select: { teamId: true, date: true, text: true } }) : [];
  const initiatives = (pkg.initiatives ?? []).length ? await db.initiative.findMany({ where: { closedAt: null }, select: { id: true, title: true } }) : [];
  const today = moscowToday();
  const staleDue = opts.staleDue ?? addDays(today, STALE_DUE_DAYS);
  if (!isIsoDate(staleDue) || staleDue < today) fail("Срок для задач без актуального срока: дата не раньше сегодняшней");
  return {
    db,
    actor,
    opts,
    today,
    staleDue,
    people,
    index: new NameIndex(people.filter((p) => p.active)),
    nodes,
    directions: new Set(dict.filter((d) => d.kind === "DIRECTION").map((d) => d.code)),
    directionIds: new Map(dict.filter((d) => d.kind === "DIRECTION").map((d) => [d.code, d.id])),
    sources: new Set(dict.filter((d) => d.kind === "TASK_SOURCE").map((d) => d.code)),
    keys: new Map(keys.map((k) => [key(k.kind as Kind, k.key), k])),
    taskKeys: new Map(keys.filter((k) => k.kind === "task").map((k) => [k.entityId, k.key])),
    // Кадровый фильтр ещё раз, теперь с фамилиями людей ресурса: «Премия Реве» узнаётся и без окончания фамилии
    excluded: new Map(personnelExclusions(pkg, surnameStems(people.map((p) => p.fullName))).map((e) => [key(e.kind, e.key), { what: e.what, text: e.text }])),
    tasks: tasks.map((t) => ({ number: t.number, title: t.title, owner: t.ownerAll ? "all" : t.ownerId, due: isoFromDbDate(t.due) })),
    decisions: decisions.map((d) => ({ teamId: d.teamId, date: isoFromDbDate(d.date), text: d.text })),
    initiatives,
    approvers: new Map(),
    missingPeople: new Set(),
    missingTeams: new Set(),
    notes: [],
    warnings: [],
  };
}

/** Человек по ФИО как в ресурсе. Выключенный и неоднозначный считаются ненайденными */
function personOf(ctx: Ctx, name: string): Person | null {
  const exact = ctx.people.find((p) => normName(p.fullName) === normName(name));
  if (exact) {
    if (!exact.active) ctx.missingPeople.add(`${name} (выключен)`);
    return exact.active ? exact : null;
  }
  const found = ctx.index.find(name);
  const p = found.person ? ctx.people.find((x) => x.id === found.person!.id) : null;
  if (!p) ctx.missingPeople.add(found.ambiguous ? `${name} (несколько похожих)` : name);
  return p ?? null;
}

function teamByName(ctx: Ctx, name: string): TeamNode | null {
  const n = normName(name);
  const team = ctx.nodes.find((t) => t.active && (t.id === name || normName(t.name) === n)) ?? (n === "top" || n === "топ-команда" ? ctx.nodes.find((t) => t.id === TOP_TEAM) : undefined);
  if (!team) ctx.missingTeams.add(name);
  return team ?? null;
}

/** Команда человека, если в пакете её нет: топ-команда, если он в ней; иначе та, которой руководит; иначе первая его */
function teamOfPerson(ctx: Ctx, personId: string, preferTop: boolean): TeamNode | null {
  const active = ctx.nodes.filter((t) => t.active);
  const top = active.find((t) => t.id === TOP_TEAM && (t.leaderId === personId || t.members.includes(personId)));
  const led = active.find((t) => t.leaderId === personId && t.id !== TOP_TEAM);
  const member = active.find((t) => t.members.includes(personId));
  return (preferTop ? (top ?? led ?? member) : (led ?? top ?? member)) ?? null;
}

/** Согласующий человека из другого департамента для того, кто загружает: он узнает о задаче (этап 54) */
async function approverOf(ctx: Ctx, personId: string): Promise<string | null> {
  if (!ctx.approvers.has(personId)) ctx.approvers.set(personId, (await approvalRule(ctx.db, ctx.actor.personId, personId, [ctx.actor.personId]))?.approverId ?? null);
  return ctx.approvers.get(personId) ?? null;
}

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
/** Запись в виде строки с ключами по алфавиту: база хранит payload как jsonb и порядок ключей в нём свой */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(",")}]`
    : v && typeof v === "object"
      ? `{${Object.keys(v as Record<string, unknown>)
          .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`)
          .join(",")}}`
      : JSON.stringify(v ?? null);
const same = (a: unknown, b: unknown) => stable(a) === stable(b);
/** Запись пакета, которую загрузка запомнила в ключе в прошлый раз (у ключей без неё: null) */
const recordOf = (old: Record<string, unknown>): Record<string, unknown> | null => (old.record && typeof old.record === "object" && !Array.isArray(old.record) ? (old.record as Record<string, unknown>) : null);
/** База полей из ключа без записи пакета */
const baseOf = (old: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(old).filter(([k]) => k !== "record"));
const ownedOf = (old: Record<string, unknown>): string[] | null => (Array.isArray(old.owned) ? (old.owned as unknown[]).filter((f): f is string => typeof f === "string") : null);
const CLOSED = ["done", "partial", "failed", "cancelled"];
/** Числа текста (даты, годы, номера) без ведущих нулей: «Сверка за 2026» и «Сверка за 2027» разные записи */
const numbersOf = (text: string) => (text.match(/\d+/g) ?? []).map((n) => String(Number(n))).sort().join(",");
/** Похожий текст: то же без учёта регистра и знаков или почти те же слова (то же правило, что у разбора встречи), и те же числа */
const similar = (a: string, b: string) => numbersOf(a) === numbersOf(b) && sameTask({ title: a, owner: "x" }, { title: b, owner: "x" });
/** Дубль загружается: включены все дубли или выбран этот */
const duplicateOn = (ctx: Ctx, id: string) => !!ctx.opts.duplicates || !!ctx.opts.duplicateKeys?.includes(id);

/**
 * Поле по трём значениям: база в ключе (old), ресурс сейчас (cur), пакет (next). Пакет поле не менял: ничего. Ресурс
 * уже такой, как в пакете: база сдвигается. Ресурс не трогали после загрузки: поле пишется. Иначе поле правили в
 * ресурсе: не трогаем, база остаётся прежней, чтобы и следующая загрузка эту правку не затёрла
 */
function threeWay(old: unknown, cur: unknown, next: unknown): "keep" | "moved" | "apply" | "edited" {
  if (same(old, next)) return "keep";
  if (same(cur, next)) return "moved";
  if (same(cur, old)) return "apply";
  return "edited";
}

// ---------- План ----------

type Level = "error" | "duplicate" | "warning";
type Step = {
  /** adopt: задача уже была в ресурсе до импорта, загрузка подхватывает её по номеру. bind: запись уже есть в ресурсе и
   *  совпадает с пакетом, загрузка только запоминает ключ */
  action: "add" | "update" | "skip" | "match" | "adopt" | "bind";
  reason?: string;
  level?: Level;
  notes?: string[];
  /** Видные предупреждения: загрузится не так, как в пакете */
  warnings?: string[];
  duplicate?: string;
  /** Подпись записи в предпросмотре, если не обычная */
  label?: string;
  /** Пропуск, при котором загрузка всё же перепишет ключ: новая запись пакета и база полей */
  remember?: boolean;
};

type ParentTarget = { key: string } | { id: string };
type GoalPlan = Step & {
  g: PackageGoal;
  teamId?: string;
  ownerSlug?: string | null;
  ownerId?: string | null;
  existingId?: string;
  /** Цель в ресурсе: команда, квартал, цель выше (у новой цели из плана) */
  quarter?: string;
  parentId?: string | null;
  input?: Record<string, string | null>;
  kept?: Record<string, unknown>;
  parent?: ParentTarget;
  parentNote?: string;
  /** Цель выше в ресурсе уже та, что в пакете */
  parentMatches?: boolean;
  /** Поля цели с тем же номером, которые в ресурсе заполнены иначе, чем в пакете (без replace останутся как в ресурсе) */
  differs?: string[];
};
/** reopen: пакет открывает закрытую задачу (срок переносится после открытия); stale: срок в пакете прошёл, задача
 *  встаёт со сроком для задач без актуального срока */
type TaskUpdate = { edit?: { title?: string; outcome?: string }; whereNow?: string; due?: IsoDate; status?: { code: PackageTask["status"]; resolution: string | null }; reopen?: boolean; stale?: boolean };
type TaskPlan = Step & {
  t: PackageTask;
  teamId?: string;
  owner?: string;
  ownerId?: string | null;
  co?: { slug: string; id: string }[];
  number?: number;
  /** id задачи в ресурсе (уже загруженной или подхваченной) */
  entityId?: string;
  /** Срок, с которым задача встанет: у открытой задачи не раньше сегодняшнего */
  due?: IsoDate;
  update?: TaskUpdate;
  kept?: Record<string, unknown>;
};
type DecisionPlan = Step & {
  d: PackageDecision;
  teamId?: string;
  ownerId?: string | null;
  existingId?: string;
  tasks?: ({ key: string } | { number: number })[];
  data?: Prisma.DecisionUncheckedUpdateInput;
  kept?: Record<string, unknown>;
};
/** taskId: задача в ресурсе, которой загрузка поставит цель (её строку загрузка запирает) */
type LinkPlan = Step & { l: PackageLink; goal?: ParentTarget; entityId?: string; taskId?: string; kept?: Record<string, unknown> };

/** Цель инициативы: id в ресурсе, ключ новой цели пакета или без цели */
type InitiativeGoal = { id: string } | { key: string } | null;
type InitiativeFields = { title: string; why: string; directionId: string | null; ownerId: string; teamId: string; goalId: string | null; state: PackageInitiative["state"]; note: string; result: string | null };
type InitiativePlan = Step & {
  x: PackageInitiative;
  existingId?: string;
  ownerId?: string;
  ownerName?: string;
  teamId?: string;
  directionId?: string | null;
  goal?: InitiativeGoal;
  /** Поля, которые загрузка запишет в уже загруженную инициативу */
  write?: Partial<InitiativeFields>;
  kept?: Record<string, unknown>;
};

type RemovalPlan = Step & { r: PackageRemoval; existingId?: string; text?: string };

type CeoPlan = Step & { c: PackageCeoReport; blocks?: ReportBlock[]; meetings?: { title: string; text: string }[] };

type Plan = { goals: GoalPlan[]; tasks: TaskPlan[]; decisions: DecisionPlan[]; links: LinkPlan[]; initiatives: InitiativePlan[]; removals: RemovalPlan[]; ceo: CeoPlan[] };

const GOAL_FIELDS = ["title", "description", "metric", "base", "target", "link", "code"] as const;
/** Поля, которые replace приводит к пакету: всё, кроме номера */
const REPLACE_FIELDS = ["title", "description", "metric", "base", "target", "link"] as const;
const GOAL_LABELS: Record<string, string> = { title: "Цель", description: "Описание", metric: "Метрика", base: "База", target: "Целевое значение", link: "Ссылка", code: "Номер" };
/** Поля цели, которые загрузка не меняет: пакет их поменял, предпросмотр об этом пишет */
const GOAL_OTHER: Record<string, string> = { owner: "Владелец", team: "Команда", quarter: "Квартал" };
const TASK_LABELS: Record<string, string> = { title: "Задача", outcome: "Что нужно сделать", due: "Срок", status: "Статус", resolution: "Итог", whereNow: "Где сейчас" };
const TASK_OTHER: Record<string, string> = { owner: "Ответственный", coExecutors: "Соисполнители", direction: "Направление", team: "Команда", priority: "Приоритет", source: "Источник", links: "Ссылки", closedAt: "Дата закрытия" };
const DECISION_OTHER: Record<string, string> = { date: "Дата", team: "Команда" };
/** Поля подхваченной задачи, которые принадлежат загрузке; остальные ведут в ресурсе */
const ADOPT_OWNED = ["whereNow", "due", "status", "resolution"];

function goalPayload(g: PackageGoal): Record<string, string | null> {
  return { title: g.title, description: g.description, metric: g.metric, base: g.base, target: g.target, link: g.link, code: g.code };
}

async function planGoals(ctx: Ctx, pkg: ContentPackage): Promise<GoalPlan[]> {
  const out: GoalPlan[] = [];
  // Номер цели в команде за квартал один: вторая цель пакета с тем же номером не загружается (служба целей откажет)
  const codes = new Set<string>();
  const taken = (quarter: string, teamId: string, code: string | null) => {
    if (!code) return false;
    const k = `${quarter}|${teamId}|${code.toLowerCase()}`;
    if (codes.has(k)) return true;
    codes.add(k);
    return false;
  };
  const repeated = (g: PackageGoal): GoalPlan => ({ g, action: "skip", level: "error", reason: `номер ${g.code} уже у другой цели пакета в той же команде и квартале: оставьте одну` });
  for (const g of pkg.goals) {
    const hr = ctx.excluded.get(key("goal", g.key));
    if (hr) {
      out.push({ g, action: "skip", level: "error", label: hr.what, reason: hr.text });
      continue;
    }
    const next = goalPayload(g);
    // Уже загружена: сначала ключ, потом люди и команды (владельца могли выключить, команду переименовать)
    const known = ctx.keys.get(key("goal", g.key));
    if (known) {
      const cur = await ctx.db.goal.findUnique({ where: { id: known.entityId } });
      if (!cur) {
        out.push({ g, action: "skip", reason: "ключ есть, цели в ресурсе нет: её удалили, загрузка её не возвращает" });
        continue;
      }
      const at = { g, teamId: cur.teamId, ownerId: cur.ownerId, existingId: cur.id, quarter: cur.quarter, parentId: cur.parentId };
      if (taken(cur.quarter, cur.teamId, g.code)) {
        out.push(repeated(g));
        continue;
      }
      if (known.hash === recordHash(g)) {
        // База остаётся прежней: она нужна, если загрузка всё же поставит цель выше
        out.push({ ...at, action: "skip", reason: UNCHANGED, kept: baseOf(asRecord(known.payload)) });
        continue;
      }
      out.push({ ...at, action: "update", ...(await planGoalUpdate(ctx, g, asRecord(known.payload), cur)) });
      continue;
    }
    const owner = g.owner ? personOf(ctx, g.owner) : null;
    if (g.owner && !owner) {
      out.push({ g, action: "skip", reason: `владелец «${g.owner}» не найден в ресурсе` });
      continue;
    }
    const team = g.team ? teamByName(ctx, g.team) : owner ? teamOfPerson(ctx, owner.id, false) : null;
    if (!team) {
      out.push({ g, action: "skip", reason: g.team ? `команды «${g.team}» нет в ресурсе` : `у ${g.owner} нет команды в ресурсе` });
      continue;
    }
    const base = { g, teamId: team.id, ownerSlug: owner?.slug ?? null, ownerId: owner?.id ?? null };
    if (taken(g.quarter, team.id, g.code)) {
      out.push(repeated(g));
      continue;
    }
    // Цель с тем же номером уже есть в команде (например, из борда лидера): ключ привязывается к ней. Без replace
    // загрузка заполняет только пустые поля, и только они дальше принадлежат загрузке; с replace цель приводится к
    // пакету целиком (так цели ресурса выравниваются по бордам)
    const byCode = g.code ? await ctx.db.goal.findFirst({ where: { quarter: g.quarter, teamId: team.id, code: g.code } }) : null;
    if (byCode) {
      const now = byCode as unknown as Record<string, string | null>;
      const input: Record<string, string | null> = {};
      const at = { ...base, action: "match" as const, existingId: byCode.id, quarter: byCode.quarter, parentId: byCode.parentId, label: `Цель ${g.code}` };
      if (g.replace) {
        for (const f of REPLACE_FIELDS) if (!same(now[f], next[f]) && (f !== "title" || next.title)) input[f] = next[f];
        // Владелец тоже как в пакете: от него зависит, чья это личная цель борда
        const notes: string[] = [];
        if (owner && byCode.ownerId !== owner.id) input.owner = owner.slug;
        else if (!g.owner && byCode.ownerId && byCode.ownerId !== team.leaderId) notes.push(`владельца в пакете нет: в ресурсе остаётся «${ctx.people.find((x) => x.id === byCode.ownerId)?.fullName ?? "прежний"}»`);
        const n = Object.keys(input).length;
        out.push({ ...at, input, notes, kept: { ...next }, reason: n ? `уже есть в ресурсе: загрузка приведёт к пакету ${n} ${plural(n, "поле", "поля", "полей")}` : "уже есть в ресурсе и совпадает с пакетом" });
      } else {
        const owned: string[] = [];
        // Поля, которые в ресурсе заполнены иначе, чем в пакете: они останутся как в ресурсе
        const differs = REPLACE_FIELDS.filter((f) => now[f] && next[f] && !same(now[f], next[f])).map((f) => GOAL_LABELS[f]!);
        Object.assign(at, { differs });
        for (const f of GOAL_FIELDS) {
          if (!now[f] && next[f]) {
            input[f] = next[f];
            owned.push(f);
          }
        }
        out.push({ ...at, input, kept: { ...next, owned }, reason: "уже есть в ресурсе: загрузка заполнит только пустые поля" });
      }
      continue;
    }
    out.push({ ...base, action: "add", quarter: g.quarter, parentId: null, kept: { ...next } });
  }
  return out;
}

/** Что загрузка поменяет в цели, которая уже загружена, и какая база останется в ключе */
async function planGoalUpdate(ctx: Ctx, g: PackageGoal, old: Record<string, unknown>, cur: { id: string; quarter: string; teamId: string; ownerId: string | null }): Promise<Pick<GoalPlan, "input" | "kept" | "notes">> {
  const next = goalPayload(g);
  const now = cur as unknown as Record<string, unknown>;
  const record = recordOf(old);
  // У цели из борда загрузке принадлежат только поля, которые она заполнила. Пакет поставил replace: дальше вся цель
  // принадлежит загрузке, поля борда приводятся к пакету
  let owned = ownedOf(old);
  const upgrade = !!owned && g.replace;
  const input: Record<string, string | null> = {};
  const kept: Record<string, unknown> = { ...next };
  const notes: string[] = [];
  for (const f of GOAL_FIELDS) {
    const value = now[f] ?? null;
    if (owned && !owned.includes(f)) {
      if (upgrade) {
        if (f !== "code" && !same(value, next[f]) && (f !== "title" || next.title)) input[f] = next[f];
      } else if (!value && next[f]) {
        // Поле борда: загрузка заполняет его, только если в ресурсе оно пустое, и тогда оно становится её полем
        input[f] = next[f];
        owned.push(f);
      }
      continue;
    }
    const way = threeWay(old[f], value, next[f]);
    if (way === "apply") input[f] = next[f];
    else if (way === "keep" || way === "edited") kept[f] = old[f] ?? null;
    if (way === "edited") notes.push(`поле «${GOAL_LABELS[f]}» правили в ресурсе, загрузка его не тронет`);
  }
  if (upgrade) {
    owned = null;
    notes.push("цель приводится к пакету целиком (replace): поля борда загрузка меняет как в пакете");
    const owner = g.owner ? personOf(ctx, g.owner) : null;
    if (owner && cur.ownerId !== owner.id) input.owner = owner.slug;
  }
  // Номер цели занят другой целью той же команды и квартала: служба целей откажет, номер не трогаем
  if (input.code && (await ctx.db.goal.findFirst({ where: { quarter: cur.quarter, teamId: cur.teamId, code: input.code, id: { not: cur.id } }, select: { id: true } }))) {
    notes.push(`номер ${input.code} уже у другой цели команды, номер не изменится`);
    kept.code = old.code ?? null;
    delete input.code;
  }
  if (owned) kept.owned = owned;
  if ("parentId" in old) kept.parentId = old.parentId ?? null;
  if ("parentOwned" in old) kept.parentOwned = old.parentOwned === true;
  if (record) for (const f of Object.keys(GOAL_OTHER)) if (!(upgrade && f === "owner") && !same(record[f], (g as Record<string, unknown>)[f])) notes.push(`поле «${GOAL_OTHER[f]}» из пакета загрузка не меняет, поправьте в ресурсе`);
  return { input, kept, notes };
}

/**
 * Цель выше: по правилам службы целей (тот же квартал, своя команда или команда выше, без петли). Иначе без неё, с
 * предупреждением. В ключе цели хранится база цели выше (parentId): какая цель выше стояла в ресурсе после загрузки.
 * Цель выше, которую в ресурсе сняли или сменили после загрузки, загрузка не трогает. Цель выше, которая в прошлый раз
 * не встала (её цель не загрузилась), ставится, как только может, даже если запись пакета та же
 */
async function planParents(ctx: Ctx, goals: GoalPlan[]): Promise<void> {
  const nodeOf = (p: GoalPlan) => p.existingId ?? `key:${p.g.key}`;
  const planned = new Map<string, string>();
  for (const p of goals) {
    const unchanged = p.action === "skip" && p.reason === UNCHANGED && !!p.existingId;
    if (p.action === "skip" && !unchanged) continue;
    const no = (text: string) => {
      p.parentNote = text;
    };
    // Цель выше, которую загрузка может сменить: с replace (цель приводится к пакету) и ту, что загрузка сама ставила и
    // в ресурсе её не трогали. Цель выше, которую ставил борд или человек, без replace загрузка не меняет, пустую ставит
    let movable = p.g.replace;
    const known = p.existingId ? ctx.keys.get(key("goal", p.g.key)) : undefined;
    if (known) {
      const old = asRecord(known.payload);
      const record = recordOf(old);
      const packageMoved = !record || !same(record.parent, p.g.parent);
      if ("parentId" in old && old.parentOwned === true) {
        const base = (old.parentId as string | null) ?? null;
        if ((p.parentId ?? null) !== base) {
          if (packageMoved && p.g.parent) no("цель выше поменяли в ресурсе после загрузки, загрузка её не тронет");
          continue;
        }
        if (base && !packageMoved) continue;
        movable = true;
      } else if (!("parentId" in old) && !packageMoved && !p.g.replace) continue;
    }
    if (!p.g.parent) {
      if (p.g.replace && p.parentId) no("цели выше в пакете нет: в ресурсе она осталась прежней");
      continue;
    }
    let target: ParentTarget | null = null;
    let parent: { node: string; teamId: string; quarter: string } | null = null;
    if ("key" in p.g.parent) {
      const pp = goals.find((x) => x.g.key === (p.g.parent as { key: string }).key);
      if (!pp || (pp.action === "skip" && !pp.existingId)) {
        no(`цель выше не загружается${pp?.reason ? `: ${pp.reason}` : ""}; цель загрузится без неё`);
        continue;
      }
      target = pp.existingId ? { id: pp.existingId } : { key: pp.g.key };
      parent = { node: nodeOf(pp), teamId: pp.teamId!, quarter: pp.quarter! };
    } else {
      const found = await ctx.db.goal.findMany({ where: { code: p.g.parent.code, quarter: p.quarter }, select: { id: true, teamId: true, quarter: true } });
      if (found.length !== 1) {
        no(`цели выше ${p.g.parent.code} ${found.length ? "несколько с таким номером" : "нет в ресурсе в том же квартале"}; цель загрузится без неё`);
        continue;
      }
      target = { id: found[0]!.id };
      parent = { node: found[0]!.id, teamId: found[0]!.teamId, quarter: found[0]!.quarter };
    }
    const self = nodeOf(p);
    if (p.parentId && "id" in target && p.parentId === target.id) {
      p.parentMatches = true;
      continue;
    }
    // Цель выше, заданную в ресурсе, меняет только replace или пакет у цели, где загрузка её и ставила
    if (p.parentId && !movable) {
      no("цель выше уже задана в ресурсе, загрузка её не тронет");
      continue;
    }
    if (parent.quarter !== p.quarter) {
      no("цель выше из другого квартала; цель загрузится без неё");
      continue;
    }
    if (![p.teamId!, ...ancestorsOf(ctx.nodes, p.teamId!)].includes(parent.teamId)) {
      no("цель выше не своей команды и не команды выше; цель загрузится без неё");
      continue;
    }
    // Петля: идём вверх от цели выше по плану и по ресурсу. Петлю замыкает цель, которая в пакете идёт позже: она
    // грузится без цели выше
    let cur: string | null = parent.node;
    const guard = new Set<string>();
    let loop = false;
    while (cur && !guard.has(cur)) {
      if (cur === self) {
        loop = true;
        break;
      }
      guard.add(cur);
      cur = planned.get(cur) ?? (cur.startsWith("key:") ? null : ((await ctx.db.goal.findUnique({ where: { id: cur }, select: { parentId: true } }))?.parentId ?? null));
    }
    if (loop) {
      no("цель не может стоять ниже самой себя; цель загрузится без цели выше");
      continue;
    }
    planned.set(self, parent.node);
    p.parent = target;
  }
  for (const p of goals) {
    // Цель без изменений, которой теперь можно поставить цель выше: обновление
    if (p.action === "skip" && p.parent) Object.assign(p, { action: "update", reason: undefined, input: {} });
    // Уже загруженная цель, которой загрузке нечего записать: пропуск, ключ запомнит новую запись пакета
    else if (p.action === "update" && !Object.keys(p.input ?? {}).length && !p.parent) Object.assign(p, { action: "skip", reason: ONLY_OTHER, remember: true });
    // Цель с тем же номером совпадает с пакетом: привязка к ресурсу
    else if (p.action === "match" && !Object.keys(p.input ?? {}).length && !p.parent) {
      const differs = p.differs ?? [];
      Object.assign(p, { action: "bind", reason: differs.length ? `уже есть в ресурсе: загрузка запомнит её ключ, поля в ресурсе останутся: ${differs.join(", ")}` : "уже есть в ресурсе и совпадает с пакетом: загрузка запомнит её ключ" });
    }
  }
}

/** База задачи в ключе: поля, которые сверяет загрузка. Итог только у закрытой задачи: у открытой служба его не хранит */
function taskPayload(t: PackageTask, due: IsoDate) {
  return { title: t.title, outcome: t.outcome, due, dueRaw: t.due, status: t.status, resolution: CLOSED.includes(t.status) ? t.resolution : null, whereNow: t.whereNow };
}

type TaskRow = { id: string; number: number; title: string; outcome: string; due: Date; status: Parameters<typeof statusCode>[0]; resolution: string | null; whereNow: string | null };

/** Те же поля задачи, как они сейчас в ресурсе */
function taskNow(row: TaskRow): Record<string, unknown> & { due: IsoDate; status: string } {
  return { title: row.title, outcome: row.outcome, due: isoFromDbDate(row.due), status: statusCode(row.status), resolution: row.resolution, whereNow: row.whereNow || null };
}

/** Есть ли что записать в задачу */
const writes = (u: TaskUpdate | undefined) => !!u && !!(u.edit || u.whereNow || u.due || u.status);

/**
 * Шаг плана для задачи, которая уже есть в ресурсе: обновление или подхват. Если записать нечего: уже загруженная
 * задача пропускается (ключ запомнит новую запись пакета), подхваченная привязывается к ресурсу
 */
function changeStep(t: PackageTask, u: Pick<TaskPlan, "update" | "kept" | "notes" | "warnings">, action: "update" | "adopt", row: TaskRow, idle: { action: "skip" | "bind"; reason: string }): TaskPlan {
  return { t, ...u, number: row.number, entityId: row.id, ...(writes(u.update) ? { action } : { ...idle, remember: true }) };
}

async function planTasks(ctx: Ctx, pkg: ContentPackage): Promise<TaskPlan[]> {
  const out: TaskPlan[] = [];
  for (const t of pkg.tasks) {
    // Кадровый фильтр первым: и для новой задачи, и для уже загруженной, и для подхваченной
    const hr = ctx.excluded.get(key("task", t.key));
    if (hr) {
      out.push({ t, action: "skip", level: "error", label: hr.what, reason: hr.text });
      continue;
    }
    // Уже загружена: сначала ключ, потом люди (ответственного могли выключить, команду переименовать)
    const known = ctx.keys.get(key("task", t.key));
    if (known) {
      const row = await ctx.db.task.findUnique({ where: { id: known.entityId } });
      if (!row) out.push({ t, action: "skip", reason: "ключ есть, задачи в ресурсе нет: её удалили, загрузка её не возвращает" });
      else if (known.hash === recordHash(t)) out.push({ t, action: "skip", number: row.number, reason: UNCHANGED });
      else if (row.archivedAt) out.push({ t, action: "skip", number: row.number, reason: `задача ${row.number} в архиве, загрузка её не правит` });
      else out.push(changeStep(t, planTaskUpdate(ctx, t, asRecord(known.payload), row), "update", row, { action: "skip", reason: ONLY_OTHER }));
      continue;
    }
    if (t.adopt) {
      out.push(await planAdopt(ctx, t));
      continue;
    }
    const all = normName(t.owner) === normName(ALL_LEADERS_NAME);
    const owner = all ? null : personOf(ctx, t.owner);
    if (!all && !owner) {
      out.push({ t, action: "skip", reason: `ответственный «${t.owner}» не найден в ресурсе` });
      continue;
    }
    if (owner?.role === "OBSERVER") {
      out.push({ t, action: "skip", level: "error", reason: `${owner.fullName} наблюдатель: наблюдатель задач не ведёт` });
      continue;
    }
    if (!ctx.directions.has(t.direction)) {
      out.push({ t, action: "skip", level: "error", reason: `направления «${t.direction}» нет в справочнике или оно скрыто` });
      continue;
    }
    if (!ctx.sources.has(t.source.kind)) {
      out.push({ t, action: "skip", level: "error", reason: `источника «${t.source.kind}» нет в справочнике или он скрыт` });
      continue;
    }
    const team = t.team ? teamByName(ctx, t.team) : all ? (ctx.nodes.find((n) => n.id === TOP_TEAM) ?? null) : teamOfPerson(ctx, owner!.id, true);
    if (!team) {
      out.push({ t, action: "skip", reason: t.team ? `команды «${t.team}» нет в ресурсе` : `у ${t.owner} нет команды в ресурсе` });
      continue;
    }
    if (all && team.id !== TOP_TEAM) {
      out.push({ t, action: "skip", level: "error", reason: "«Все лидеры» бывают только у задач топ-команды" });
      continue;
    }
    const co: { slug: string; id: string }[] = [];
    const notes: string[] = [];
    for (const name of t.coExecutors) {
      const p = personOf(ctx, name);
      if (p && p.role !== "OBSERVER" && p.id !== owner?.id) co.push({ slug: p.slug, id: p.id });
      else if (!p) notes.push(`соисполнитель «${name}» не найден, задача загрузится без него`);
      else if (p.role === "OBSERVER") notes.push(`${p.fullName} наблюдатель, соисполнителем не будет`);
    }
    // Открытая задача со сроком в прошлом встаёт со сроком, который выбрал владелец (по умолчанию через две недели):
    // служба задач не ставит открытых задач в прошлое, а срок «сегодня» дал бы просрочку уже на неделе загрузки
    const closed = CLOSED.includes(t.status);
    const due = !closed && t.due < ctx.today ? ctx.staleDue : t.due;
    const step: TaskPlan = { t, teamId: team.id, owner: all ? "all" : owner!.slug, ownerId: owner?.id ?? null, co, notes, action: "add", due };
    // Вероятный дубль: тот же ответственный, похожее название с теми же числами и срок не дальше трёх недель
    const owned = all ? "all" : (owner?.id ?? null);
    const twin = ctx.tasks.find((e) => numbersOf(e.title) === numbersOf(t.title) && Math.abs(diffDays(e.due, due)) <= DUPLICATE_DUE_DAYS && sameTask({ title: t.title, owner: owned }, e));
    if (twin) {
      const id = `task/${t.key}`;
      const text = `похожа на задачу ${twin.number} «${short(twin.title)}»: тот же ответственный, похожее название и близкий срок`;
      if (!duplicateOn(ctx, id)) {
        out.push({ ...step, action: "skip", level: "duplicate", duplicate: id, reason: `${text}, пропустится` });
        continue;
      }
      step.level = "duplicate";
      step.duplicate = id;
      step.reason = `${text}, загрузится, как вы выбрали`;
    }
    out.push(step);
  }
  return out;
}

/**
 * Подхват задачи, поставленной в ресурсе до импорта (adopt): по номеру, названию и команде. База полей в ключе: задача
 * как она есть в ресурсе, поэтому дальше загрузка ведёт только её статус, итог, «Где сейчас» и срок, как у своей задачи.
 * Подхваченная задача не дубль и срок по умолчанию не получает: срок в прошлом из пакета просто не переносится
 */
async function planAdopt(ctx: Ctx, t: PackageTask): Promise<TaskPlan> {
  const n = t.adopt!.number;
  const row = await ctx.db.task.findUnique({ where: { number: n }, include: { owner: { select: { id: true, fullName: true } } } });
  if (!row) return { t, action: "skip", reason: `задачи ${n} нет в ресурсе` };
  // Названия сравниваются после одной и той же чистки: в ресурсе могут быть знаки, которые пакет уже убрал
  if (normName(cleanText(row.title)) !== normName(cleanText(t.adopt!.title))) return { t, action: "skip", reason: `под номером ${n} в ресурсе другая задача: «${short(row.title)}»` };
  if (row.archivedAt) return { t, action: "skip", reason: `задача ${n} в архиве, загрузка её не правит` };
  const other = ctx.taskKeys.get(row.id);
  if (other) return { t, action: "skip", reason: `задача ${n} уже загружена из пакета с ключом ${other}` };
  // Команда: задачу другой команды загрузка не подхватывает. Команда из пакета, иначе команды ответственного из пакета
  const all = normName(t.owner) === normName(ALL_LEADERS_NAME);
  const owner = all ? null : quietPerson(ctx, t.owner);
  const rowTeam = ctx.nodes.find((x) => x.id === row.teamId)?.name ?? row.teamId;
  if (!t.team && !all && !owner) {
    return { t, action: "skip", level: "error", reason: `в пакете нет команды, а ответственного «${t.owner}» нет в ресурсе: сверить команду задачи не с чем, укажите команду в пакете` };
  }
  if (t.team) {
    const team = teamByName(ctx, t.team);
    if (!team) return { t, action: "skip", reason: `команды «${t.team}» нет в ресурсе` };
    if (team.id !== row.teamId) return { t, action: "skip", level: "error", reason: `задача ${n} в ресурсе в команде «${rowTeam}», а в пакете в команде «${team.name}»: задачу другой команды загрузка не подхватывает` };
  } else if (all ? row.teamId !== TOP_TEAM : !ctx.nodes.some((x) => x.id === row.teamId && (x.leaderId === owner!.id || x.members.includes(owner!.id)))) {
    return { t, action: "skip", level: "error", reason: `задача ${n} в ресурсе в команде «${rowTeam}», а ${all ? "«Все лидеры» бывают только в топ-команде" : `${owner!.fullName} не в этой команде`}: задачу другой команды загрузка не подхватывает, укажите команду в пакете` };
  }
  const now = taskNow(row);
  const u: Pick<TaskPlan, "update" | "kept" | "notes" | "warnings"> = planTaskUpdate(ctx, t, { ...now, dueRaw: now.due }, row, true);
  const ownerName = row.ownerAll ? ALL_LEADERS_NAME : (row.owner?.fullName ?? "");
  if (normName(t.owner) !== normName(ownerName)) u.warnings = [`в пакете ответственный «${t.owner}», в ресурсе «${ownerName || "не назначен"}»: ответственного загрузка не меняет`];
  return changeStep(t, u, "adopt", row, { action: "bind", reason: "подхвачена по номеру: в задаче менять нечего, загрузка привяжет к ней ключ пакета" });
}

/** Человек по ФИО без отметки «нет в ресурсе»: для сверки, а не для записи */
function quietPerson(ctx: Ctx, name: string): Person | null {
  const exact = ctx.people.find((p) => p.active && normName(p.fullName) === normName(name));
  if (exact) return exact;
  const found = ctx.index.find(name);
  return found.person ? (ctx.people.find((x) => x.id === found.person!.id) ?? null) : null;
}

/**
 * Что загрузка поменяет в задаче, которая уже есть в ресурсе, и какая база останется в ключе. adopt: задача подхвачена
 * по номеру, база это сама задача в ресурсе, загрузке принадлежат только статус, итог, «Где сейчас» и срок
 */
function planTaskUpdate(ctx: Ctx, t: PackageTask, old: Record<string, unknown>, row: TaskRow, adopt = false): Pick<TaskPlan, "update" | "kept" | "notes"> {
  const next = taskPayload(t, t.due);
  const cur = taskNow(row);
  const owned = adopt ? [...ADOPT_OWNED] : ownedOf(old);
  const own = (f: string) => !owned || owned.includes(f);
  const kept: Record<string, unknown> = { ...next };
  const notes: string[] = [];
  const update: TaskUpdate = {};
  const edited = (f: string) => notes.push(`поле «${TASK_LABELS[f]}» правили в ресурсе, загрузка его не тронет`);

  for (const f of ["title", "outcome"] as const) {
    if (!own(f)) {
      kept[f] = old[f] ?? null;
      continue;
    }
    const way = threeWay(old[f], cur[f], next[f]);
    if (way === "apply") update.edit = { ...update.edit, [f]: next[f] };
    else if (way === "keep" || way === "edited") kept[f] = old[f] ?? null;
    if (way === "edited") edited(f);
  }

  const where = own("whereNow") ? threeWay(old.whereNow, cur.whereNow, next.whereNow) : "keep";
  if (where === "apply" && next.whereNow) update.whereNow = next.whereNow;
  else if (where !== "moved") kept.whereNow = old.whereNow ?? null;
  if (where === "edited") edited("whereNow");
  if (where === "apply" && !next.whereNow) notes.push("«Где сейчас» в пакете пустое: в ресурсе останется прежний текст, стирают его только в карточке");

  // Статус и итог: итог в ресурсе меняется только вместе со статусом, поэтому решаем о них вместе. Статус раньше срока:
  // от него зависит, можно ли перенести срок
  const curStatusClosed = CLOSED.includes(cur.status);
  const statusChanged = !same(old.status, next.status);
  const resolutionChanged = !same(old.resolution, next.resolution);
  kept.status = old.status ?? null;
  kept.resolution = old.resolution ?? null;
  if (own("status") && (statusChanged || resolutionChanged)) {
    const statusUntouched = same(cur.status, old.status);
    const resolutionUntouched = same(cur.resolution, old.resolution);
    const asInPackage = same(cur.status, next.status) && same(cur.resolution, next.resolution);
    if (asInPackage) {
      kept.status = next.status;
      kept.resolution = next.resolution;
    } else if (cur.status === "proposed") {
      notes.push("задача ждёт принятия в ресурсе: статус загрузка не меняет");
    } else if (adopt && curStatusClosed) {
      // Подхваченную закрытую задачу загрузка не открывает и итог не меняет ни сейчас, ни в следующие разы
      notes.push("задача закрыта в ресурсе, загрузка её не открывает и не меняет итог");
      owned!.splice(0, owned!.length, ...owned!.filter((f) => f !== "status" && f !== "resolution"));
    } else if (statusUntouched && resolutionUntouched && cur.status !== next.status) {
      update.status = { code: t.status, resolution: next.resolution };
      update.reopen = curStatusClosed && !CLOSED.includes(t.status);
      kept.status = next.status;
      kept.resolution = next.resolution;
    } else if (!statusUntouched) edited("status");
    else if (!resolutionUntouched) notes.push("итог правили в ресурсе: статус и итог из пакета загрузка не тронет");
    else notes.push("итог поменялся только в пакете, а статус тот же: итог в ресурсе меняют только вместе со статусом, в карточке задачи");
  }

  // Срок: меняется, только если в пакете поменялся сам срок. База: срок, с которым задача стоит после загрузки, и срок
  // пакета, который загрузка учла. Срок не записан: обе базы прежние. Открытой задаче срок переносят после открытия
  const closedAtTransfer = curStatusClosed && !update.reopen;
  kept.due = old.due ?? null;
  kept.dueRaw = old.dueRaw ?? old.due ?? null;
  if (own("due") && !same(old.dueRaw ?? old.due, t.due)) {
    const way = same(cur.due, t.due) ? "moved" : same(cur.due, old.due) ? "apply" : "edited";
    if (way === "moved") {
      kept.due = t.due;
      kept.dueRaw = t.due;
    } else if (way === "edited") edited("due");
    else if (closedAtTransfer || t.due < ctx.today) {
      // Открываемой задаче с прошедшим сроком срок ставится ниже (срок для задач без актуального срока): без заметки
      if (!(update.reopen && cur.due < ctx.today)) notes.push(`срок ${formatLong(t.due)} не перенесён: задача закрыта или срок уже прошёл`);
    } else {
      update.due = t.due;
      kept.due = t.due;
      kept.dueRaw = t.due;
    }
  }
  // Пакет открывает задачу, а её срок уже прошёл: как у новой открытой задачи, срок для задач без актуального срока
  if (update.reopen && (update.due ?? cur.due) < ctx.today) {
    update.due = ctx.staleDue;
    update.stale = true;
    kept.due = ctx.staleDue;
    kept.dueRaw = t.due;
  }
  if (owned) kept.owned = owned;
  // Поля, которые загрузка не меняет: пакет их поменял после прошлой загрузки
  const record = adopt ? null : recordOf(old);
  if (record) for (const f of Object.keys(TASK_OTHER)) if (!same(record[f], (t as Record<string, unknown>)[f])) notes.push(`поле «${TASK_OTHER[f]}» из пакета загрузка не меняет, поправьте в ресурсе`);
  return { update, kept, notes };
}

async function planDecisions(ctx: Ctx, pkg: ContentPackage, tasks: TaskPlan[]): Promise<DecisionPlan[]> {
  const out: DecisionPlan[] = [];
  for (const d of pkg.decisions) {
    const hr = ctx.excluded.get(key("decision", d.key));
    if (hr) {
      out.push({ d, action: "skip", level: "error", label: hr.what, reason: hr.text });
      continue;
    }
    // Задачи решения: из пакета (по ключу, если задача загружается, подхвачена или уже загружена) или из ресурса по номеру
    const refs: ({ key: string } | { number: number })[] = [];
    const refNotes: string[] = [];
    for (const ref of d.tasks) {
      if ("number" in ref) {
        const row = await ctx.db.task.findUnique({ where: { number: ref.number }, select: { archivedAt: true } });
        if (row && !row.archivedAt) refs.push(ref);
        else refNotes.push(`задачи ${ref.number} нет в ресурсе или она в архиве, решение загрузится без неё`);
        continue;
      }
      const tp = tasks.find((p) => p.t.key === ref.key);
      if (tp && (tp.action === "add" || tp.number)) refs.push(ref);
      else refNotes.push(`${nameOf(ctx, "task", ref.key, tp?.t.title ?? ref.key)} не загружается, решение загрузится без неё`);
    }
    // Уже загружено: сначала ключ, потом команда и люди
    const known = ctx.keys.get(key("decision", d.key));
    if (known) {
      const cur = await ctx.db.decision.findUnique({ where: { id: known.entityId } });
      if (!cur) {
        out.push({ d, action: "skip", reason: "ключ есть, решения в ресурсе нет: его удалили, загрузка его не возвращает" });
        continue;
      }
      if (known.hash === recordHash(d)) {
        out.push({ d, action: "skip", existingId: cur.id, tasks: refs, reason: UNCHANGED });
        continue;
      }
      const old = asRecord(known.payload);
      const record = recordOf(old);
      const u = planDecisionUpdate(ctx, d, old, cur);
      // Новые связи с задачами добавляются, прежние не убираются: обновление, если пакет поменял список задач
      const newTasks = !record || !same(record.tasks, d.tasks);
      const step: DecisionPlan = { d, existingId: cur.id, tasks: refs, ...u, notes: [...(newTasks ? refNotes : []), ...(u.notes ?? [])], action: "update" };
      out.push(Object.keys(u.data ?? {}).length || newTasks ? step : { ...step, action: "skip", reason: ONLY_OTHER, remember: true });
      continue;
    }
    // Решение без команды в топ-команду само не уходит: команду пишут в пакете
    if (!d.team) {
      out.push({ d, action: "skip", level: "error", reason: "нет команды: решение без команды не загружается, укажите команду в пакете" });
      continue;
    }
    const team = teamByName(ctx, d.team);
    if (!team) {
      out.push({ d, action: "skip", reason: `команды «${d.team}» нет в ресурсе` });
      continue;
    }
    const notes: string[] = [];
    const owner = d.owner ? personOf(ctx, d.owner) : null;
    if (d.owner && !owner) notes.push(`владелец «${d.owner}» не найден, решение загрузится без владельца`);
    const step: DecisionPlan = { d, teamId: team.id, ownerId: owner?.id ?? null, tasks: refs, notes: [...notes, ...refNotes], action: "add" };
    // Вероятный дубль: решение той же команды за ту же дату с похожим текстом и теми же числами уже есть в ресурсе
    const twin = ctx.decisions.find((e) => e.teamId === team.id && e.date === d.date && similar(e.text, d.text));
    if (twin) {
      const id = `decision/${d.key}`;
      const text = `похоже на решение команды за ${formatLong(d.date)} «${short(twin.text)}»`;
      if (!duplicateOn(ctx, id)) {
        out.push({ ...step, action: "skip", level: "duplicate", duplicate: id, reason: `${text}, пропустится` });
        continue;
      }
      step.level = "duplicate";
      step.duplicate = id;
      step.reason = `${text}, загрузится, как вы выбрали`;
    }
    out.push(step);
  }
  return out;
}

function planDecisionUpdate(ctx: Ctx, d: PackageDecision, old: Record<string, unknown>, cur: { text: string; ownerId: string | null; status: string }): Pick<DecisionPlan, "data" | "kept" | "notes"> {
  const notes: string[] = [];
  const record = recordOf(old);
  // Владельца ищем, только если пакет его поменял: выключенный потом владелец с решения не снимается
  let ownerId: unknown = old.ownerId ?? null;
  if (!record || !same(record.owner, d.owner)) {
    const owner = d.owner ? personOf(ctx, d.owner) : null;
    if (d.owner && !owner) notes.push(`владелец «${d.owner}» не найден, владелец не меняется`);
    else ownerId = owner?.id ?? null;
  }
  const next: Record<string, unknown> = { text: d.text, ownerId, status: d.status };
  const now: Record<string, unknown> = { text: cur.text, ownerId: cur.ownerId, status: cur.status === "CANCELLED" ? "cancelled" : "active" };
  const kept: Record<string, unknown> = { ...next };
  const data: Prisma.DecisionUncheckedUpdateInput = {};
  const labels: Record<string, string> = { text: "Решение", ownerId: "Владелец решения", status: "Статус решения" };
  for (const f of ["text", "ownerId", "status"] as const) {
    const way = threeWay(old[f], now[f], next[f]);
    if (way === "keep" || way === "edited") kept[f] = old[f] ?? null;
    if (way === "edited") notes.push(`поле «${labels[f]}» правили в ресурсе, загрузка его не тронет`);
    if (way !== "apply") continue;
    if (f === "text") data.text = d.text;
    else if (f === "ownerId") data.ownerId = ownerId as string | null;
    else if (d.status === "cancelled") Object.assign(data, { status: "CANCELLED", cancelReason: d.cancelReason, cancelledAt: new Date(), cancelledById: ctx.actor.personId });
    else Object.assign(data, { status: "ACTIVE", cancelReason: null, cancelledAt: null, cancelledById: null });
  }
  if (record) for (const f of Object.keys(DECISION_OTHER)) if (!same(record[f], (d as Record<string, unknown>)[f])) notes.push(`поле «${DECISION_OTHER[f]}» из пакета загрузка не меняет, поправьте в ресурсе`);
  return { data, kept, notes };
}

type GoalInfo = { id: string | null; pending?: string; teamId?: string; ownerId?: string | null; source?: string; quarter?: string; skip?: string };

/** Цель связи: из пакета (по ключу) или уже в ресурсе (по номеру). Удалённая и снятая цель не подходят */
async function goalOfLink(ctx: Ctx, l: PackageLink, goals: GoalPlan[], quarters: string[]): Promise<GoalInfo> {
  const ref = l.goal;
  const select = { id: true, teamId: true, ownerId: true, source: true, quarter: true, result: true } as const;
  if ("key" in ref) {
    const plan = goals.find((p) => p.g.key === ref.key);
    if (!plan) return { id: null, skip: "цели нет в пакете" };
    if (plan.action === "add") {
      // Новая цель: владелец как его поставит служба целей (без владельца руководитель команды), источник из пакета
      const leader = ctx.nodes.find((n) => n.id === plan.teamId)?.leaderId ?? null;
      return { id: null, pending: plan.g.key, teamId: plan.teamId, ownerId: plan.ownerId ?? leader, source: plan.g.source ?? "manual", quarter: plan.g.quarter };
    }
    if (!plan.existingId) return { id: null, skip: `${nameOf(ctx, "goal", plan.g.key, plan.g.title)} не загружается: ${plan.reason}` };
    const g = await ctx.db.goal.findUnique({ where: { id: plan.existingId }, select });
    if (!g) return { id: null, skip: "цель удалили в ресурсе, связь пропущена" };
    if (g.result === "DROPPED") return { id: null, skip: "цель снята в ресурсе" };
    return { id: g.id, teamId: g.teamId, ownerId: g.ownerId, source: g.source, quarter: g.quarter };
  }
  const found = await ctx.db.goal.findMany({ where: { code: ref.code, quarter: { in: quarters } }, select });
  if (found.length !== 1) return { id: null, skip: found.length > 1 ? `цель ${ref.code}: несколько целей с таким номером` : `цели ${ref.code} нет в ресурсе в текущем квартале или квартале срока` };
  const g = found[0]!;
  if (g.result === "DROPPED") return { id: null, skip: "цель снята в ресурсе" };
  return { id: g.id, teamId: g.teamId, ownerId: g.ownerId, source: g.source, quarter: g.quarter };
}

async function planLinks(ctx: Ctx, pkg: ContentPackage, tasks: TaskPlan[], goals: GoalPlan[]): Promise<LinkPlan[]> {
  const out: LinkPlan[] = [];
  // Одна задача в одном пакете привязывается одной связью: по ключу и по номеру это та же задача
  const linkedBy = new Map<string, string>();
  for (const l of pkg.links) {
    // Кадровые сведения в причине связи: связь не грузится, причина не попадает в ключ
    const hr = ctx.excluded.get(key("link", l.key));
    if (hr) {
      out.push({ l, action: "skip", level: "error", label: hr.what, reason: hr.text });
      continue;
    }
    const known = ctx.keys.get(key("link", l.key));
    if (known && known.hash === recordHash(l)) {
      out.push({ l, action: "skip", reason: UNCHANGED });
      continue;
    }
    // Задача: из пакета по ключу, по номеру (и тогда её запись в пакете, если задача загружена или подхвачена) или новая
    const tp = "key" in l.task ? tasks.find((p) => p.t.key === (l.task as { key: string }).key) : tasks.find((p) => p.number === (l.task as { number: number }).number);
    if ("key" in l.task && tp && tp.action === "skip" && !tp.number) {
      out.push({ l, action: "skip", reason: `${nameOf(ctx, "task", tp.t.key, tp.t.title)} не загружается: ${tp.reason}` });
      continue;
    }
    const number = "number" in l.task ? l.task.number : tp?.number;
    const row = number ? await ctx.db.task.findUnique({ where: { number }, select: { id: true, teamId: true, ownerId: true, due: true, goalId: true, archivedAt: true, coExecutors: { select: { personId: true } } } }) : null;
    if (number && !row) {
      out.push({ l, action: "skip", reason: `задачи ${number} нет в ресурсе` });
      continue;
    }
    if (row?.archivedAt) {
      out.push({ l, action: "skip", reason: `задача ${number} в архиве` });
      continue;
    }
    if (!row && !tp) {
      out.push({ l, action: "skip", reason: "задачи нет в пакете" });
      continue;
    }
    // Квартал по сроку, который будет у задачи после загрузки: срок переносится раньше, чем ставится связь
    const due = tp?.update?.due ?? (row ? isoFromDbDate(row.due) : tp!.due!);
    const quarters = [quarterOf(ctx.today), quarterOf(due)];
    const goal = await goalOfLink(ctx, l, goals, quarters);
    if (goal.skip) {
      out.push({ l, action: "skip", reason: goal.skip });
      continue;
    }
    if (goal.quarter && !quarters.includes(goal.quarter)) {
      out.push({ l, action: "skip", reason: "цель из другого квартала: задачу привязывают к цели текущего квартала или квартала её срока" });
      continue;
    }
    const teamId = row?.teamId ?? tp!.teamId!;
    const people = row ? [...(row.ownerId ? [row.ownerId] : []), ...row.coExecutors.map((c) => c.personId)] : [...(tp!.ownerId ? [tp!.ownerId] : []), ...(tp!.co ?? []).map((c) => c.id)];
    if (goal.teamId && !goalFits({ source: goal.source ?? "manual", ownerId: goal.ownerId ?? null, teamId: goal.teamId }, { teamId }, people, ctx.nodes)) {
      out.push({ l, action: "skip", reason: "цель не своей команды и не команды выше и не личная цель людей задачи: так задачу к цели не привязать" });
      continue;
    }
    const target: ParentTarget = goal.pending ? { key: goal.pending } : { id: goal.id! };
    const notes: string[] = [];
    const identity = row ? `id:${row.id}` : `key:${tp!.t.key}`;
    const first = linkedBy.get(identity);
    if (first) {
      out.push({ l, action: "skip", level: "error", reason: `задачу уже привязывает связь ${first} этого пакета: у задачи одна цель, оставьте одну связь` });
      continue;
    }
    linkedBy.set(identity, l.key);
    if (known) {
      const old = asRecord(known.payload);
      const record = recordOf(old);
      if (!record || same(record.task, l.task)) {
        // Цель задачи поменяли в ресурсе после прошлой загрузки: не трогаем
        if ((row?.goalId ?? null) !== (old.goalId ?? null)) out.push({ l, action: "skip", reason: "цель задачи поменяли в ресурсе после прошлой загрузки" });
        // Поменялись только уверенность или причина: в ресурсе им места нет, ключ запомнит новую запись
        else if (record && same(record.goal, l.goal)) out.push({ l, action: "skip", reason: UNCHANGED, remember: true, entityId: known.entityId, kept: { goalId: old.goalId ?? null } });
        else out.push({ l, action: "update", goal: target, taskId: row?.id });
        continue;
      }
      // Пакет перенёс связь на другую задачу: она проверяется как новая связь, прежняя задача свою цель сохраняет
      notes.push("связь перенесена на другую задачу: у прежней задачи цель остаётся, снять её можно в карточке");
    }
    // У задачи в ресурсе уже другая цель: загрузка её не меняет, какая бы цель ни была в пакете (и новая цель пакета тоже)
    if (row?.goalId && !("id" in target && row.goalId === target.id)) {
      out.push({ l, action: "skip", reason: `у задачи ${number} в ресурсе уже другая цель`, notes });
      continue;
    }
    if (row?.goalId) {
      out.push({ l, action: known ? "update" : "bind", goal: target, reason: known ? undefined : "задача уже с этой целью: загрузка запомнит ключ связи", notes });
      continue;
    }
    out.push({ l, action: known ? "update" : "add", goal: target, notes, taskId: row?.id });
  }
  return out;
}

const INITIATIVE_LABELS: Record<keyof InitiativeFields, string> = {
  title: "Инициатива",
  why: "Зачем",
  directionId: "Продукт",
  ownerId: "Ответственный",
  teamId: "Команда",
  goalId: "Цель",
  state: "Деление шкалы",
  note: "Что сейчас происходит",
  result: "Итог",
};
const CLOSED_INITIATIVE = ["done", "dropped"];

/** Деление инициативы в ресурсе словами пакета: закрытая по итогу, открытая по шкале */
function initiativeState(row: { state: string; closedAt: Date | null; result: string | null }): PackageInitiative["state"] {
  if (row.closedAt) return row.result === "DROPPED" ? "dropped" : "done";
  return row.state === "DOING" ? "doing" : "searching";
}

/** Цель инициативы: новая или уже загруженная цель пакета по ключу, иначе цель текущего квартала по номеру */
async function goalOfInitiative(ctx: Ctx, x: PackageInitiative, goals: GoalPlan[], notes: string[]): Promise<InitiativeGoal> {
  const ref = x.goal;
  if (!ref) return null;
  if ("key" in ref) {
    const plan = goals.find((p) => p.g.key === ref.key);
    if (plan?.existingId) return { id: plan.existingId };
    if (plan?.action === "add") return { key: ref.key };
    notes.push(`цель с ключом ${ref.key} не загружается, инициатива загрузится без цели`);
    return null;
  }
  const found = await ctx.db.goal.findMany({ where: { code: ref.code, quarter: quarterOf(ctx.today), result: { not: "DROPPED" } }, select: { id: true } });
  if (found.length === 1) return { id: found[0]!.id };
  notes.push(found.length > 1 ? `цель ${ref.code}: несколько целей с таким номером, инициатива загрузится без цели` : `цели ${ref.code} нет в текущем квартале, инициатива загрузится без цели`);
  return null;
}

async function planInitiatives(ctx: Ctx, pkg: ContentPackage, goals: GoalPlan[]): Promise<InitiativePlan[]> {
  const out: InitiativePlan[] = [];
  for (const x of pkg.initiatives ?? []) {
    const hr = ctx.excluded.get(key("initiative", x.key));
    if (hr) {
      out.push({ x, action: "skip", level: "error", label: hr.what, reason: hr.text });
      continue;
    }
    const known = ctx.keys.get(key("initiative", x.key));
    // Скрытый продукт: новая инициатива с ним не встаёт, у загруженной он ошибка, только если пакет его поменял
    const changedDirection = !known || !same(recordOf(asRecord(known.payload))?.direction ?? null, x.direction);
    if (x.direction && changedDirection && !ctx.directions.has(x.direction)) {
      out.push({ x, action: "skip", level: "error", reason: `продукта «${x.direction}» нет в справочнике направлений или он скрыт` });
      continue;
    }
    if (known) {
      const cur = await ctx.db.initiative.findUnique({ where: { id: known.entityId } });
      if (!cur) {
        out.push({ x, action: "skip", reason: "ключ есть, инициативы в ресурсе нет: её удалили, загрузка её не возвращает" });
        continue;
      }
      if (known.hash === recordHash(x)) {
        out.push({ x, action: "skip", existingId: cur.id, reason: UNCHANGED });
        continue;
      }
      out.push(await planInitiativeUpdate(ctx, x, asRecord(known.payload), cur, goals));
      continue;
    }
    const owner = personOf(ctx, x.owner);
    if (!owner) {
      out.push({ x, action: "skip", reason: `ответственный «${x.owner}» не найден в ресурсе` });
      continue;
    }
    if (owner.role === "OBSERVER") {
      out.push({ x, action: "skip", level: "error", reason: `${owner.fullName} наблюдатель: наблюдатель не отвечает за инициативу` });
      continue;
    }
    const team = teamByName(ctx, x.team ?? TOP_TEAM);
    if (!team) {
      out.push({ x, action: "skip", reason: `команды «${x.team}» нет в ресурсе` });
      continue;
    }
    const notes: string[] = [];
    const goal = await goalOfInitiative(ctx, x, goals, notes);
    const step: InitiativePlan = { x, action: "add", ownerId: owner.id, ownerName: owner.fullName, teamId: team.id, directionId: x.direction ? ctx.directionIds.get(x.direction)! : null, goal, notes };
    // Вероятный дубль: открытая инициатива в ресурсе с похожим названием
    const twin = ctx.initiatives.find((i) => similar(i.title, x.title));
    if (twin) {
      const id = `initiative/${x.key}`;
      const text = `похоже на открытую инициативу «${short(twin.title)}»`;
      if (!duplicateOn(ctx, id)) {
        out.push({ ...step, action: "skip", level: "duplicate", duplicate: id, reason: `${text}, пропустится` });
        continue;
      }
      Object.assign(step, { level: "duplicate", duplicate: id, reason: `${text}, загрузится, как вы выбрали` });
    }
    out.push(step);
  }
  // Шкала задумана для 15 самых крупных: больше открытых она покажет предупреждением, загрузка его повторяет заранее
  const opened = out.filter((p) => p.action === "add" && !CLOSED_INITIATIVE.includes(p.x.state)).length;
  const total = ctx.initiatives.length + opened;
  if (opened && total > INITIATIVES_SOFT_MAX) {
    ctx.warnings.push({ what: "Крупные инициативы", text: `открытых станет ${total}, а шкала задумана для ${INITIATIVES_SOFT_MAX} самых крупных. Долго ищущие (дольше 4 недель) и без новостей 2 недели сами встают в повестку встречи команды` });
  }
  return out;
}

async function planInitiativeUpdate(
  ctx: Ctx,
  x: PackageInitiative,
  old: Record<string, unknown>,
  cur: { id: string; title: string; why: string; directionId: string | null; ownerId: string; teamId: string; goalId: string | null; state: string; note: string; closedAt: Date | null; result: string | null; resultNote: string | null },
  goals: GoalPlan[],
): Promise<InitiativePlan> {
  const notes: string[] = [];
  const record = recordOf(old);
  // Люди, команда и цель ищутся, только если пакет их поменял: выключенный потом человек с инициативы не снимается
  let ownerId = (old.ownerId as string | undefined) ?? cur.ownerId;
  if (!record || !same(record.owner, x.owner)) {
    const owner = personOf(ctx, x.owner);
    if (!owner || owner.role === "OBSERVER") notes.push(`ответственный «${x.owner}» не найден или наблюдатель, ответственный не меняется`);
    else ownerId = owner.id;
  }
  let teamId = (old.teamId as string | undefined) ?? cur.teamId;
  if (!record || !same(record.team, x.team)) {
    const team = teamByName(ctx, x.team ?? TOP_TEAM);
    if (!team) notes.push(`команды «${x.team}» нет в ресурсе, команда не меняется`);
    else teamId = team.id;
  }
  let goal: InitiativeGoal = old.goalId ? { id: old.goalId as string } : null;
  if (!record || !same(record.goal, x.goal)) goal = await goalOfInitiative(ctx, x, goals, notes);
  const goalId = goal && "id" in goal ? goal.id : null;
  const next: InitiativeFields = {
    title: x.title,
    why: x.why ?? "",
    // Скрытый продукт, который пакет не менял: остаётся тот, что загрузка поставила раньше
    directionId: x.direction ? (ctx.directionIds.get(x.direction) ?? (old.directionId as string | null | undefined) ?? cur.directionId) : null,
    ownerId,
    teamId,
    goalId,
    state: x.state,
    note: x.note ?? "",
    result: CLOSED_INITIATIVE.includes(x.state) ? x.result : null,
  };
  const now: InitiativeFields = {
    title: cur.title,
    why: cur.why,
    directionId: cur.directionId,
    ownerId: cur.ownerId,
    teamId: cur.teamId,
    goalId: cur.goalId,
    state: initiativeState(cur),
    note: cur.note,
    result: cur.closedAt ? cur.resultNote : null,
  };
  // Заметки в пакете нет: загрузка её не стирает (как «Где сейчас» у задач)
  if (x.note === null) next.note = (old.note as string | undefined) ?? cur.note;
  const kept: Record<string, unknown> = { ...next };
  const write: Partial<InitiativeFields> = {};
  const ways: Partial<Record<keyof InitiativeFields, ReturnType<typeof threeWay>>> = {};
  let goalPending: { key: string } | undefined;
  for (const f of Object.keys(INITIATIVE_LABELS) as (keyof InitiativeFields)[]) {
    // Новая цель пакета (ещё без id): пишется после целей, база запомнит её id. Цель, которую в ресурсе поменяли или
    // сняли после прошлой загрузки, не трогаем
    if (f === "goalId" && goal && "key" in goal) {
      if (same(cur.goalId ?? null, old.goalId ?? null)) goalPending = goal;
      else {
        kept.goalId = old.goalId ?? null;
        notes.push(`поле «${INITIATIVE_LABELS[f]}» правили в ресурсе, загрузка его не тронет`);
      }
      continue;
    }
    const way = threeWay(old[f] ?? null, now[f], next[f]);
    ways[f] = way;
    if (way === "keep" || way === "edited") kept[f] = old[f] ?? null;
    if (way === "edited") notes.push(`поле «${INITIATIVE_LABELS[f]}» правили в ресурсе, загрузка его не тронет`);
    if (way === "apply") Object.assign(write, { [f]: next[f] });
  }
  // Пакет открывает закрытую инициативу, а итог в ресурсе правили: закрытие с итогом остаётся как в ресурсе
  if (write.state && !CLOSED_INITIATIVE.includes(write.state) && now.state !== "searching" && now.state !== "doing" && ways.result === "edited") {
    delete write.state;
    kept.state = old.state ?? null;
    notes.push("итог закрытой инициативы правили в ресурсе: загрузка её не открывает");
  }
  // Итог без закрытия не пишется: у открытой инициативы итога нет, база итога остаётся прежней
  if ("result" in write && !CLOSED_INITIATIVE.includes((write.state ?? now.state) as string)) {
    delete write.result;
    kept.result = old.result ?? null;
  }
  const step: InitiativePlan = { x, existingId: cur.id, write, kept, notes, goal: goalPending ?? (goalId ? { id: goalId } : null), action: "update" };
  return Object.keys(write).length || goalPending ? step : { ...step, action: "skip", reason: ONLY_OTHER, remember: true };
}

/** Стереть решение можно, только если его ставила загрузка (есть ключ) и текст в ресурсе тот, что она оставила */
async function planRemovals(ctx: Ctx, pkg: ContentPackage): Promise<RemovalPlan[]> {
  const out: RemovalPlan[] = [];
  for (const r of pkg.remove ?? []) {
    const known = ctx.keys.get(key("decision", r.key));
    if (!known) {
      out.push({ r, action: "skip", reason: "этого решения загрузка не ставила или его уже стёрли" });
      continue;
    }
    const cur = await ctx.db.decision.findUnique({ where: { id: known.entityId }, select: { id: true, text: true } });
    if (!cur) {
      // Решение уже стёрли в ресурсе: загрузка забудет и его ключ
      out.push({ r, action: "skip", reason: "решения в ресурсе уже нет, загрузка забудет его ключ", remember: true });
      continue;
    }
    const old = asRecord(known.payload);
    if (typeof old.text === "string" && old.text !== cur.text) {
      out.push({ r, action: "skip", level: "warning", existingId: cur.id, text: cur.text, reason: "текст решения правили в ресурсе, загрузка его не стирает" });
      continue;
    }
    out.push({ r, action: "add", existingId: cur.id, text: cur.text });
  }
  return out;
}

/** Блоки отчёта из пакета: ключи этапа 66, названия стандартных блоков, продукты из справочника; все правлены руками */
function ceoBlocksOf(ctx: Ctx, c: PackageCeoReport): ReportBlock[] {
  const raw = c.blocks.map((b) => ({ key: b.key, title: standardOf(b.key)?.title ?? "", lines: b.lines.map((l) => ({ text: l.text, product: l.product })), edited: true }));
  return cleanBlocks(raw, ctx.directions).map((b) => ({ ...b, edited: true }));
}

const hasCeoText = (r: { main: string; risks: string; next: string; meetings: unknown; blocks: unknown }) =>
  !!(r.main.trim() || r.risks.trim() || r.next.trim() || (Array.isArray(r.meetings) && r.meetings.length) || (Array.isArray(r.blocks) && r.blocks.length));

async function planCeoReports(ctx: Ctx, pkg: ContentPackage): Promise<CeoPlan[]> {
  const out: CeoPlan[] = [];
  for (const c of pkg.ceoReports ?? []) {
    const hr = ctx.excluded.get(key("ceo", c.key));
    if (hr) {
      out.push({ c, action: "skip", level: "error", label: hr.what, reason: hr.text });
      continue;
    }
    if (c.week > ctx.today) {
      out.push({ c, action: "skip", level: "error", reason: "неделя ещё не началась: загрузка ставит отчёты прошедших недель" });
      continue;
    }
    const blocks = ceoBlocksOf(ctx, c);
    const unknown = c.blocks.filter((b) => !blocks.some((x) => x.key === b.key)).map((b) => b.key);
    const notes = unknown.length ? [`блоков ${unknown.join(", ")} в отчёте CEO нет, они не загрузятся`] : [];
    const meetings = cleanMeetings(c.meetings);
    const week = await ctx.db.week.findUnique({ where: { start: dbDate(c.week) }, select: { ceoReport: true } });
    const cur = week?.ceoReport ?? null;
    const known = ctx.keys.get(key("ceo", c.key));
    if (known && known.hash === recordHash(c)) {
      out.push({ c, action: "skip", reason: UNCHANGED });
      continue;
    }
    if (cur?.sentAt) {
      out.push({ c, action: "skip", reason: "отчёт за эту неделю уже отправлен CEO, загрузка его не трогает" });
      continue;
    }
    if (known) {
      const old = asRecord(known.payload);
      if (cur && !(same(cur.blocks ?? null, old.blocks ?? null) && same(cur.meetings ?? [], old.meetings ?? []))) {
        out.push({ c, action: "skip", level: "warning", reason: "отчёт правили в ресурсе после загрузки, загрузка его не трогает" });
        continue;
      }
      out.push({ c, action: "update", blocks, meetings, notes });
      continue;
    }
    if (cur && hasCeoText(cur)) {
      out.push({ c, action: "skip", level: "warning", reason: "отчёт за эту неделю уже есть в ресурсе, загрузка его не трогает" });
      continue;
    }
    out.push({ c, action: "add", blocks, meetings, notes });
  }
  return out;
}

async function buildPlan(ctx: Ctx, pkg: ContentPackage): Promise<Plan> {
  const goals = await planGoals(ctx, pkg);
  await planParents(ctx, goals);
  const tasks = await planTasks(ctx, pkg);
  const decisions = await planDecisions(ctx, pkg, tasks);
  const links = await planLinks(ctx, pkg, tasks, goals);
  const initiatives = await planInitiatives(ctx, pkg, goals);
  const removals = await planRemovals(ctx, pkg);
  const ceo = await planCeoReports(ctx, pkg);
  return { goals, tasks, decisions, links, initiatives, removals, ceo };
}

/** Привязка к ресурсу (bind) в эти числа не входит: она в своём списке */
function counts<T extends { action: string }>(list: T[]): ImportCounts {
  return {
    add: list.filter((x) => x.action === "add").length,
    update: list.filter((x) => x.action === "update" || x.action === "match" || x.action === "adopt").length,
    skip: list.filter((x) => x.action === "skip").length,
  };
}

/** Кто узнает о новых открытых задачах: ответственный, соисполнители и согласующие из других департаментов */
async function notifiedPeople(ctx: Ctx, plan: Plan): Promise<number> {
  const ids = new Set<string>();
  for (const p of plan.tasks) {
    if (p.action !== "add" || CLOSED.includes(p.t.status)) continue;
    for (const id of [p.ownerId, ...(p.co ?? []).map((c) => c.id)]) {
      if (!id) continue;
      ids.add(id);
      const approver = await approverOf(ctx, id);
      if (approver) ids.add(approver);
    }
  }
  ids.delete(ctx.actor.personId);
  return ids.size;
}

async function summarize(ctx: Ctx, pkg: ContentPackage, plan: Plan): Promise<ImportPreview> {
  const lists: Record<"errors" | "notes" | "warnings" | "bound", ImportLine[]> = { errors: [], notes: [], warnings: [], bound: [] };
  const duplicates: DuplicateLine[] = [];
  const put = (fallback: string, p: Step) => {
    const what = p.label ?? fallback;
    if (p.action === "bind") lists.bound.push({ what, text: p.reason ?? "уже есть в ресурсе: загрузка запомнит ключ" });
    else if (p.reason && p.reason !== UNCHANGED) {
      if (p.level === "duplicate" && p.duplicate) duplicates.push({ id: p.duplicate, what, text: p.reason, on: p.action === "add" });
      else (p.level === "error" ? lists.errors : p.level === "warning" ? lists.warnings : lists.notes).push({ what, text: p.reason });
    }
    for (const text of p.warnings ?? []) lists.warnings.push({ what, text });
    for (const text of p.notes ?? []) lists.notes.push({ what, text });
  };
  for (const p of plan.goals) {
    put(`Цель «${short(p.g.title)}»`, p);
    if (p.parentNote) lists.warnings.push({ what: `Цель «${short(p.g.title)}»`, text: p.parentNote });
  }
  for (const p of plan.tasks) put(p.number ? `Задача ${p.number}` : `Задача «${short(p.t.title)}»`, p);
  for (const p of plan.decisions) put(`Решение «${short(p.d.text)}»`, p);
  for (const p of plan.links) put(`Связь ${p.l.key}`, p);
  for (const p of plan.initiatives) put(`Инициатива «${short(p.x.title)}»`, p);
  for (const p of plan.ceo) put(`Weekly для CEO за неделю с ${formatLong(p.c.week)}`, p);
  for (const p of plan.removals) if (p.action === "skip") put(p.text ? `Стереть решение «${short(p.text)}»` : `Стереть решение ${p.r.key}`, p);
  const unchanged = [...plan.goals, ...plan.tasks, ...plan.decisions, ...plan.links, ...plan.initiatives].filter((p) => p.reason === UNCHANGED).length;
  if (unchanged) lists.notes.unshift({ what: "Без изменений", text: `${unchanged} ${unchanged === 1 ? "запись уже загружена" : "записей уже загружено"} в том же виде` });
  return {
    title: pkg.title,
    tasks: counts(plan.tasks),
    decisions: counts(plan.decisions),
    goals: counts(plan.goals),
    links: counts(plan.links),
    initiatives: counts(plan.initiatives),
    ceoReports: counts(plan.ceo),
    removals: { remove: plan.removals.filter((p) => p.action === "add").length, skip: plan.removals.filter((p) => p.action === "skip").length },
    missingPeople: [...ctx.missingPeople].sort((a, b) => a.localeCompare(b, "ru")),
    missingTeams: [...ctx.missingTeams].sort((a, b) => a.localeCompare(b, "ru")),
    errors: lists.errors.slice(0, 300),
    warnings: [...ctx.warnings, ...lists.warnings].slice(0, 300),
    bound: lists.bound.slice(0, 300),
    duplicates: duplicates.slice(0, 300),
    withDuplicates: !!ctx.opts.duplicates,
    // Новые открытые задачи со сроком в прошлом и задачи, которые пакет снова открывает, а их срок уже прошёл
    staleTasks: plan.tasks.filter((p) => (p.action === "add" && p.due !== p.t.due) || (p.action === "update" && p.update?.stale)).map((p) => ({ key: p.t.key, title: p.t.title, due: p.t.due })),
    staleDue: ctx.staleDue,
    notes: [...lists.notes, ...ctx.notes].slice(0, 300),
    notified: await notifiedPeople(ctx, plan),
  };
}

/** Предпросмотр: ничего не пишет */
export async function previewContentImport(actor: Actor, pkg: ContentPackage, opts: ImportOptions = {}): Promise<ImportPreview> {
  if (!canImportContent(actor)) fail(IMPORT_ONLY);
  const ctx = await context(prisma, actor, pkg, opts);
  return summarize(ctx, pkg, await buildPlan(ctx, pkg));
}

// ---------- Загрузка ----------

/** Ключ записи: отпечаток, база полей и сама запись пакета (по ней следующая загрузка видит, что пакет поменял) */
async function remember(tx: Tx, kind: Kind, k: string, entityId: string, record: unknown, base: Record<string, unknown>) {
  const hash = recordHash(record);
  const data = { entityId, hash, payload: { ...base, record } as unknown as Prisma.InputJsonValue, updatedAt: new Date() };
  await tx.contentImportKey.upsert({ where: { kind_key: { kind, key: k } }, update: data, create: { kind, key: k, ...data } });
}

/**
 * День закрытия задачи из истории: дата закрытия из пакета, иначе срок, если он прошёл, иначе дата источника, иначе
 * сегодня. Так «закрыто на этой неделе» в аналитике не растёт от загрузки
 */
function historyClosedAt(t: PackageTask, today: IsoDate): Date {
  const day = t.closedAt && t.closedAt <= today ? t.closedAt : t.due <= today ? t.due : t.source.date && t.source.date <= today ? t.source.date : today;
  return moscowDateTime(toCalendar(day), 12, 0);
}

/**
 * Строки ресурса, которые загрузка по плану запишет: задачи (правка, подхват с правками, цель задачи), цели (поля,
 * владелец, цель выше), решения (текст, владелец, статус). Строки, на которые план только ссылается (цель выше, задача
 * решения, цель связи), и записи без изменений не запираются
 */
function writtenRows(plan: Plan): { tasks: string[]; goals: string[]; decisions: string[]; initiatives: string[] } {
  const tasks = new Set<string>();
  const goals = new Set<string>();
  const decisions = new Set<string>();
  const initiatives = new Set<string>();
  for (const p of plan.initiatives) if (p.action === "update" && p.existingId) initiatives.add(p.existingId);
  for (const p of plan.removals) if (p.action === "add" && p.existingId) decisions.add(p.existingId);
  for (const p of plan.tasks) if ((p.action === "update" || p.action === "adopt") && p.entityId) tasks.add(p.entityId);
  for (const p of plan.links) if ((p.action === "add" || p.action === "update") && p.taskId) tasks.add(p.taskId);
  for (const p of plan.goals) if ((p.action === "update" || p.action === "match") && p.existingId && (Object.keys(p.input ?? {}).length || p.parent)) goals.add(p.existingId);
  for (const p of plan.decisions) if (p.action === "update" && p.existingId && Object.keys(p.data ?? {}).length) decisions.add(p.existingId);
  return { tasks: [...tasks], goals: [...goals], decisions: [...decisions], initiatives: [...initiatives] };
}

/** Запереть строки FOR UPDATE в порядке id: встречные правки ждут конца загрузки */
async function lockIds(tx: Tx, ids: { tasks: string[]; goals: string[]; decisions: string[]; initiatives: string[] }): Promise<void> {
  if (ids.tasks.length) await tx.$queryRaw`SELECT "id" FROM "tasks" WHERE "id" = ANY(${ids.tasks}::text[]) ORDER BY "id" FOR UPDATE`;
  if (ids.goals.length) await tx.$queryRaw`SELECT "id" FROM "goals" WHERE "id" = ANY(${ids.goals}::text[]) ORDER BY "id" FOR UPDATE`;
  if (ids.decisions.length) await tx.$queryRaw`SELECT "id" FROM "decisions" WHERE "id" = ANY(${ids.decisions}::text[]) ORDER BY "id" FOR UPDATE`;
  if (ids.initiatives.length) await tx.$queryRaw`SELECT "id" FROM "initiatives" WHERE "id" = ANY(${ids.initiatives}::text[]) ORDER BY "id" FOR UPDATE`;
}

/** Postgres снял загрузку из-за встречной правки (взаимная блокировка, конфликт записи) */
function conflictOf(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown; cause?: unknown };
  const text = `${String(e.code ?? "")} ${String(e.message ?? "")} ${JSON.stringify(e.cause ?? null)}`;
  return e.code === "P2034" || /40P01|40001|deadlock|could not serialize/i.test(text);
}
export const IMPORT_CONFLICT = "Загрузку прервала одновременная правка в ресурсе, база не тронута. Повторите загрузку";

/** Сколько номеров задач взять заранее: новые задачи по плану (лишние номера потом возвращаются) */
async function newTaskCount(actor: Actor, pkg: ContentPackage, opts: ImportOptions): Promise<number> {
  const ctx = await context(prisma, actor, pkg, opts);
  return (await planTasks(ctx, pkg)).filter((p) => p.action === "add").length;
}

export async function applyContentImport(actor: Actor, pkg: ContentPackage, opts: ImportOptions = {}): Promise<ImportResult> {
  if (!canImportContent(actor)) fail(IMPORT_ONLY);
  // Номера новых задач берём заранее короткой транзакцией: иначе загрузка держала бы строку настройки номеров всю
  // долгую транзакцию, и задачи, которые в это время ставят люди, падали бы по ожиданию. Неиспользованный хвост и
  // номера отменённой загрузки возвращаются, если после них никто номер не брал
  const reserved = await reserveTaskNumbers(await newTaskCount(actor, pkg, opts));
  const free = [...reserved];
  const end = reserved.length ? reserved[reserved.length - 1]! + 1 : 0;
  let result: ImportResult;
  try {
    result = await prisma.$transaction((tx) => applyIn(tx, actor, pkg, opts, free), { timeout: 300_000, maxWait: 15_000 });
  } catch (error) {
    if (reserved.length) await releaseTaskNumbers(reserved[0]!, end).catch(() => undefined);
    if (!(error instanceof TaskRuleError) && conflictOf(error)) throw new TaskRuleError(IMPORT_CONFLICT);
    throw error;
  }
  if (free.length) await releaseTaskNumbers(free[0]!, end).catch(() => undefined);
  return result;
}

async function applyIn(tx: Tx, actor: Actor, pkg: ContentPackage, opts: ImportOptions, free: number[]): Promise<ImportResult> {
  // Две загрузки сразу идут по очереди: вторая видит ключи первой и ничего не дублирует
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('content.import'))`;
  // План без блокировок, потом запираются только строки, которые загрузка запишет, и план считается заново по ним:
  // то, что поменяли в ресурсе до блокировки, план уже видит, а правка во время записи ждёт её конца
  let ctx = await context(tx, actor, pkg, opts);
  let plan = await buildPlan(ctx, pkg);
  const locked = { tasks: new Set<string>(), goals: new Set<string>(), decisions: new Set<string>(), initiatives: new Set<string>() };
  for (let round = 0; round < 3; round++) {
    const want = writtenRows(plan);
    const fresh = {
      tasks: want.tasks.filter((id) => !locked.tasks.has(id)),
      goals: want.goals.filter((id) => !locked.goals.has(id)),
      decisions: want.decisions.filter((id) => !locked.decisions.has(id)),
      initiatives: want.initiatives.filter((id) => !locked.initiatives.has(id)),
    };
    if (!fresh.tasks.length && !fresh.goals.length && !fresh.decisions.length && !fresh.initiatives.length) break;
    await lockIds(tx, fresh);
    for (const id of fresh.tasks) locked.tasks.add(id);
    for (const id of fresh.goals) locked.goals.add(id);
    for (const id of fresh.decisions) locked.decisions.add(id);
    for (const id of fresh.initiatives) locked.initiatives.add(id);
    ctx = await context(tx, actor, pkg, opts);
    plan = await buildPlan(ctx, pkg);
  }
  const where = <T>(what: string, run: () => Promise<T>): Promise<T> =>
    run().catch((error: unknown) => {
      if (error instanceof TaskRuleError) throw new TaskRuleError(`Загрузка не прошла, база не тронута. ${what}: ${error.message}`);
      throw error;
    });
  const goalIds = new Map<string, string>();
  let goalsDone = 0;

  // Цели: сначала все сами цели, потом цель выше, потом ключи (в базе ключа цель выше, какой она стала в ресурсе)
  const goalKeys: { p: GoalPlan; id: string }[] = [];
  for (const p of plan.goals) {
    const g = p.g;
    if (p.existingId) goalIds.set(g.key, p.existingId);
    if (p.action === "add") {
      const created = await where(`Цель «${short(g.title)}»`, () =>
        createGoal(actor, { quarter: g.quarter, title: g.title, description: g.description, metric: g.metric, base: g.base, target: g.target, team: p.teamId, owner: p.ownerSlug ?? null, link: g.link, code: g.code }, tx, { source: g.source ?? undefined }),
      );
      goalIds.set(g.key, created.id);
      goalKeys.push({ p, id: created.id });
      goalsDone += 1;
    } else if (p.action === "match" || p.action === "update") {
      if (Object.keys(p.input ?? {}).length) await where(`Цель «${short(g.title)}»`, () => updateGoal(actor, p.existingId!, p.input!, tx));
      goalKeys.push({ p, id: p.existingId! });
      goalsDone += 1;
    } else if ((p.action === "bind" || p.remember) && p.existingId) goalKeys.push({ p, id: p.existingId });
  }
  for (const p of plan.goals) {
    if (!p.parent) continue;
    const id = goalIds.get(p.g.key);
    const parentId = "id" in p.parent ? p.parent.id : goalIds.get(p.parent.key);
    if (id && parentId) await where(`Цель «${short(p.g.title)}»`, () => updateGoal(actor, id, { parent: parentId }, tx));
  }
  for (const { p, id } of goalKeys) {
    // База цели выше и чья она (parentOwned): загрузке принадлежит только цель выше, которую она сама поставила (или
    // replace, когда в ресурсе уже та, что в пакете). Свою цель выше, снятую в ресурсе, загрузка не возвращает: база
    // остаётся прежней. Цель выше от борда или человека база только отмечает
    const row = await tx.goal.findUniqueOrThrow({ where: { id }, select: { parentId: true } });
    const kept = p.kept ?? {};
    let parent: { parentId: string | null; parentOwned: boolean };
    if (p.parent) parent = { parentId: row.parentId, parentOwned: true };
    else if (kept.parentOwned === true) parent = { parentId: (kept.parentId as string | null) ?? null, parentOwned: true };
    else parent = { parentId: row.parentId, parentOwned: !!p.parentMatches && p.g.replace };
    await remember(tx, "goal", p.g.key, id, p.g, { ...kept, ...parent });
  }

  // Задачи: служба задач ставит их от имени того, кто загружает
  const taskNumbers = new Map<string, number>();
  const created: number[] = [];
  for (const p of plan.tasks) {
    const t = p.t;
    if (p.number) taskNumbers.set(t.key, p.number);
    if (p.action === "add") {
      const closed = CLOSED.includes(t.status);
      const res = await where(`Задача «${short(t.title)}»`, () =>
        createTaskIn(
          tx,
          actor,
          {
            title: t.title,
            outcome: t.outcome,
            owner: p.owner!,
            coExecutors: p.co!.map((c) => c.slug),
            direction: t.direction,
            priority: t.priority ?? undefined,
            due: p.due!,
            source: t.source.kind,
            sourceNote: t.source.note ?? undefined,
            links: t.links.map((l) => ({ title: l.title ?? undefined, url: l.url })),
            team: p.teamId,
          },
          // Срок сдвинут (открытая задача со сроком в прошлом): исходным сроком остаётся срок из пакета
          { history: { sourceDate: t.source.date, closed, ...(p.due !== t.due ? { originalDue: t.due } : {}) }, number: free.shift() },
        ),
      );
      const number = res.task.number;
      taskNumbers.set(t.key, number);
      created.push(number);
      const row = await tx.task.findUniqueOrThrow({ where: { number }, select: { id: true } });
      if (t.whereNow) await where(`Задача ${number}`, () => updateWhere(actor, number, t.whereNow!, tx));
      if (t.status !== "in-progress") await where(`Задача ${number}`, () => changeStatus(actor, number, t.status, t.resolution ?? undefined, tx));
      if (closed) {
        // Задача из истории уже закрыта: события «Новая задача для вас» и о согласовании о ней только мешают, а дата
        // закрытия историческая, чтобы «закрыто на этой неделе» в аналитике не выросло от загрузки
        await tx.inboxEvent.deleteMany({ where: { OR: [{ taskId: row.id }, { subject: { startsWith: `approval-co:${row.id}:` } }] } });
        await tx.task.update({ where: { id: row.id }, data: { closedAt: historyClosedAt(t, ctx.today) } });
      }
      await remember(tx, "task", t.key, row.id, t, taskPayload(t, p.due!));
    } else if (p.action === "update" || p.action === "adopt") {
      const number = p.number!;
      const u = p.update ?? {};
      // Строка задачи заперта с начала загрузки, но то, что в ресурсе уже так, считаем без изменений, а не ошибкой
      const now = () => tx.task.findUniqueOrThrow({ where: { number }, select: { title: true, outcome: true, whereNow: true, due: true, status: true } });
      const before = await now();
      const edit = Object.fromEntries(Object.entries(u.edit ?? {}).filter(([f, v]) => (before as Record<string, unknown>)[f] !== v));
      if (Object.keys(edit).length) await where(`Задача ${number}`, () => editTask(actor, number, edit, tx));
      if (u.whereNow && u.whereNow !== before.whereNow) await where(`Задача ${number}`, () => updateWhere(actor, number, u.whereNow!, tx));
      const transfer = async () => {
        if (u.due && u.due !== isoFromDbDate((await now()).due)) await where(`Задача ${number}`, () => transferDue(actor, number, u.due!, IMPORT_TRANSFER_REASON, tx));
      };
      // Срок переносят открытой задаче: до закрытия или после открытия
      if (!u.reopen) await transfer();
      if (u.status && statusCode((await now()).status) !== u.status.code) {
        await where(`Задача ${number}`, () => changeStatus(actor, number, u.status!.code, u.status!.resolution ?? undefined, tx));
        if (CLOSED.includes(u.status.code)) await tx.task.update({ where: { number }, data: { closedAt: historyClosedAt(t, ctx.today) } });
      }
      if (u.reopen) await transfer();
      await remember(tx, "task", t.key, p.entityId!, t, p.kept!);
    } else if ((p.action === "bind" || p.remember) && p.entityId) await remember(tx, "task", t.key, p.entityId, t, p.kept!);
  }

  // Решения: к команде и дате; без встречи, если её в ресурсе не было. Владельцам о старых решениях не сообщаем
  let decisionsDone = 0;
  // Задачи, которые получили ключ в этой загрузке (новые, подхваченные, привязанные): решения, уже загруженные раньше,
  // привязываются к ним (после перезаливки или когда подхват прошёл со второго раза)
  const createdKeys = new Set(plan.tasks.filter((p) => p.action === "add" || p.action === "adopt" || p.action === "bind").map((p) => p.t.key));
  const taskIdsOf = async (refs: DecisionPlan["tasks"], only?: Set<string>) => {
    const ids: string[] = [];
    for (const ref of refs ?? []) {
      if (only && !("key" in ref && only.has(ref.key))) continue;
      const number = "number" in ref ? ref.number : taskNumbers.get(ref.key);
      const row = number ? await tx.task.findUnique({ where: { number }, select: { id: true } }) : null;
      if (row) ids.push(row.id);
    }
    return [...new Set(ids)];
  };
  for (const p of plan.decisions) {
    const d = p.d;
    if (p.action === "skip") {
      // Решение уже загружено, а его задачу загрузка поставила заново (например, после перезаливки): связь возвращается
      if (p.existingId) {
        const ids = await taskIdsOf(p.tasks, createdKeys);
        if (ids.length) await tx.decisionTask.createMany({ data: ids.map((taskId) => ({ decisionId: p.existingId!, taskId })), skipDuplicates: true });
        if (p.remember) await remember(tx, "decision", d.key, p.existingId, d, p.kept!);
      }
      continue;
    }
    const taskIds = await taskIdsOf(p.tasks);
    if (p.action === "add") {
      const row = await tx.decision.create({
        data: {
          teamId: p.teamId!,
          text: d.text,
          ownerId: p.ownerId ?? null,
          date: dbDate(d.date),
          createdById: actor.personId,
          ...(d.status === "cancelled" ? { status: "CANCELLED" as const, cancelReason: d.cancelReason, cancelledAt: new Date(), cancelledById: actor.personId } : {}),
          tasks: { create: taskIds.map((taskId) => ({ taskId })) },
        },
      });
      await tx.auditLog.create({
        data: { action: "meeting.decision", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: row.id, field: "Решение из наполнения", after: `${formatLong(d.date)}: ${d.text}`, ip: actor.ip ?? null, via: actor.via ?? null },
      });
      await remember(tx, "decision", d.key, row.id, d, { text: d.text, ownerId: p.ownerId ?? null, status: d.status });
    } else {
      const cur = await tx.decision.findUniqueOrThrow({ where: { id: p.existingId! }, select: { id: true, text: true } });
      if (Object.keys(p.data ?? {}).length) {
        await tx.decision.update({ where: { id: cur.id }, data: p.data! });
        await tx.auditLog.create({
          data: { action: "meeting.decision", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: cur.id, field: "Решение обновлено из наполнения", before: cur.text, after: p.data!.text === undefined ? cur.text : d.text, ip: actor.ip ?? null, via: actor.via ?? null },
        });
      }
      // Новые связи с задачами добавляем, прежние не убираем
      if (taskIds.length) await tx.decisionTask.createMany({ data: taskIds.map((taskId) => ({ decisionId: cur.id, taskId })), skipDuplicates: true });
      await remember(tx, "decision", d.key, cur.id, d, p.kept!);
    }
    decisionsDone += 1;
  }

  // Связи задач с целями: через то же правило, что в карточке задачи
  let linksDone = 0;
  for (const p of plan.links) {
    const l = p.l;
    if (p.action === "skip") {
      if (p.remember && p.entityId) await remember(tx, "link", l.key, p.entityId, l, p.kept!);
      continue;
    }
    const bind = p.action === "bind";
    const number = "number" in l.task ? l.task.number : taskNumbers.get(l.task.key);
    const goalId = !p.goal ? null : "id" in p.goal ? p.goal.id : (goalIds.get(p.goal.key) ?? null);
    if (!number || !goalId) {
      // Задача или цель не загрузились в этот раз: связь пропускается, счёт и пояснение в итоге поправляются
      Object.assign(p, { action: "skip", reason: "задача или цель не нашлась после загрузки, связь пропущена" });
      continue;
    }
    const task = await tx.task.findUniqueOrThrow({ where: { number }, select: { id: true, goalId: true } });
    if (task.goalId !== goalId) await where(`Связь задачи ${number} с целью`, () => linkTaskGoal(actor, number, goalId, tx));
    await remember(tx, "link", l.key, task.id, l, { goalId });
    if (!bind) linksDone += 1;
  }

  const initiativesDone = await applyInitiatives(tx, actor, plan, goalIds);

  // Weekly для CEO: блоки и прежние разделы из них (их читают выгрузка и всё, что знает отчёт в прежнем виде)
  let ceoDone = 0;
  if (plan.ceo.some((p) => p.action !== "skip")) {
    const dict = await tx.dictionaryItem.findMany({ where: { kind: "DIRECTION" }, orderBy: [{ sortOrder: "asc" }, { label: "asc" }], select: { code: true, label: true } });
    const labels = Object.fromEntries(dict.map((d) => [d.code, d.label]));
    const order = dict.map((d) => d.code);
    for (const p of plan.ceo) {
      if (p.action === "skip") continue;
      const week = await ensureWeek(tx, p.c.week);
      const legacy = blocksToLegacy(p.blocks!, labels, order);
      const data = { ...legacy, blocks: p.blocks as unknown as Prisma.InputJsonValue, meetings: p.meetings as unknown as Prisma.InputJsonValue, updatedById: actor.personId };
      const saved = await tx.ceoReport.upsert({ where: { weekId: week.id }, update: data, create: { ...data, weekId: week.id } });
      await tx.auditLog.create({
        data: { action: "ceo.save", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "ceo-report", entityId: p.c.week, field: "Отчёт CEO из пакета наполнения", after: legacy.main.slice(0, 2000), ip: actor.ip ?? null, via: actor.via ?? null },
      });
      // База: блоки и встречи, какими их записала загрузка (из базы, в том виде, в каком их хранит jsonb)
      const row = await tx.ceoReport.findUniqueOrThrow({ where: { id: saved.id }, select: { blocks: true, meetings: true } });
      await remember(tx, "ceo", p.c.key, saved.id, p.c, { blocks: row.blocks, meetings: row.meetings });
      ceoDone += 1;
    }
  }

  // Стирание решений: запись в журнале с текстом раньше самого стирания, ключ забывается
  let removed = 0;
  for (const p of plan.removals) {
    if (p.action === "skip") {
      if (p.remember) await tx.contentImportKey.deleteMany({ where: { kind: "decision", key: p.r.key } });
      continue;
    }
    await tx.auditLog.create({
      data: { action: "decision.delete", actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "decision", entityId: p.existingId!, field: "Решение стёрто из наполнения", before: p.text ?? "", ip: actor.ip ?? null, via: actor.via ?? null },
    });
    await tx.decision.delete({ where: { id: p.existingId! } });
    await tx.contentImportKey.deleteMany({ where: { kind: "decision", key: p.r.key } });
    removed += 1;
  }

  const result: ImportResult = { ...(await summarize(ctx, pkg, plan)), applied: { tasks: created, goals: goalsDone, decisions: decisionsDone, links: linksDone, initiatives: initiativesDone, removed, ceoReports: ceoDone } };
  await tx.auditLog.create({
    data: {
      action: "content.import",
      actorId: actor.personId,
      actorName: actor.fullName,
      source: "APP",
      entity: "content",
      entityId: pkg.title ?? "пакет наполнения",
      field: "Загружено наполнение",
      after: `Задачи: новых ${result.tasks.add}, обновлено ${result.tasks.update}, пропущено ${result.tasks.skip}. Решения: новых ${result.decisions.add}, обновлено ${result.decisions.update}, пропущено ${result.decisions.skip}. Цели: новых ${result.goals.add}, обновлено ${result.goals.update}, пропущено ${result.goals.skip}. Связи с целями: новых ${result.links.add}, обновлено ${result.links.update}, пропущено ${result.links.skip}${(pkg.initiatives ?? []).length ? `. Инициативы: новых ${result.initiatives.add}, обновлено ${result.initiatives.update}, пропущено ${result.initiatives.skip}` : ""}${(pkg.ceoReports ?? []).length ? `. Weekly для CEO: новых ${result.ceoReports.add}, обновлено ${result.ceoReports.update}, пропущено ${result.ceoReports.skip}` : ""}${(pkg.remove ?? []).length ? `. Стёрто решений: ${removed}, пропущено ${result.removals.skip}` : ""}`,
      ip: actor.ip ?? null,
      via: actor.via ?? null,
    },
  });
  return result;
}

const STATE_DB_OF: Record<string, "SEARCHING" | "DOING"> = { searching: "SEARCHING", doing: "DOING" };
const RESULT_DB_OF: Record<string, "DONE" | "DROPPED"> = { done: "DONE", dropped: "DROPPED" };
const RESULT_WORDS: Record<string, string> = { done: "Сделали", dropped: "Сняли" };

/**
 * Инициативы: после целей, чтобы цель пакета уже была с id. Новая встаёт с делением и заметкой из пакета (закрытая
 * сразу с итогом), у загруженной пишутся только поля из плана. Каждое изменение в истории инициативы и в журнале
 */
async function applyInitiatives(tx: Tx, actor: Actor, plan: Plan, goalIds: Map<string, string>): Promise<number> {
  let done = 0;
  const now = new Date();
  const goalOf = (g: InitiativeGoal | undefined): string | null => (!g ? null : "id" in g ? g.id : (goalIds.get(g.key) ?? null));
  const audit = (action: string, id: string, title: string, after: string) =>
    tx.auditLog.create({ data: { action, actorId: actor.personId, actorName: actor.fullName, source: "APP", entity: "initiative", entityId: id, field: title, after, ip: actor.ip ?? null, via: actor.via ?? null } });
  let order = (await tx.initiative.aggregate({ _max: { sortOrder: true }, where: { closedAt: null } }))._max.sortOrder ?? 0;
  for (const p of plan.initiatives) {
    const x = p.x;
    if (p.action === "skip") {
      if (p.remember && p.existingId) await remember(tx, "initiative", x.key, p.existingId, x, p.kept!);
      continue;
    }
    if (p.action === "add") {
      const closed = CLOSED_INITIATIVE.includes(x.state);
      const state = closed ? "SEARCHING" : STATE_DB_OF[x.state]!;
      const goalId = goalOf(p.goal);
      order += 1;
      const row = await tx.initiative.create({
        data: {
          title: x.title,
          why: x.why ?? "",
          ownerId: p.ownerId!,
          teamId: p.teamId!,
          directionId: p.directionId ?? null,
          goalId,
          state,
          stateSince: now,
          note: x.note ?? "",
          noteAt: now,
          sortOrder: order,
          createdById: actor.personId,
          createdAt: now,
          ...(closed ? { result: RESULT_DB_OF[x.state], resultNote: x.result, closedAt: now } : {}),
          changes: {
            create: [
              { kind: "create", toState: state, note: x.note || "Из пакета наполнения", byId: actor.personId, at: now },
              ...(closed ? [{ kind: "close", note: `${RESULT_WORDS[x.state]}: ${x.result}`, byId: actor.personId, at: now }] : []),
            ],
          },
        },
      });
      await audit("initiative.create", row.id, x.title, `из пакета наполнения, ответственный ${p.ownerName}`);
      await remember(tx, "initiative", x.key, row.id, x, { title: x.title, why: x.why ?? "", directionId: p.directionId ?? null, ownerId: p.ownerId, teamId: p.teamId, goalId, state: x.state, note: x.note ?? "", result: closed ? x.result : null });
      done += 1;
      continue;
    }
    // Обновление уже загруженной: только поля из плана
    const id = p.existingId!;
    const cur = await tx.initiative.findUniqueOrThrow({ where: { id }, select: { title: true, state: true, closedAt: true, result: true } });
    const w = p.write ?? {};
    const data: Prisma.InitiativeUncheckedUpdateInput = {};
    const changes: Prisma.InitiativeChangeCreateManyInput[] = [];
    for (const f of ["title", "why", "directionId", "ownerId", "teamId"] as const) if (f in w) Object.assign(data, { [f]: w[f] });
    const goalId = p.goal && "key" in p.goal ? goalOf(p.goal) : "goalId" in w ? (w.goalId ?? null) : undefined;
    if (goalId !== undefined) data.goalId = goalId;
    if (Object.keys(data).length) changes.push({ initiativeId: id, kind: "ownerId" in data ? "owner" : "edit", note: "Из пакета наполнения", byId: actor.personId, at: now });
    if ("note" in w) {
      Object.assign(data, { note: w.note, noteAt: now });
      changes.push({ initiativeId: id, kind: "note", note: w.note || null, byId: actor.personId, at: now });
    }
    const was = initiativeState(cur);
    if (w.state && w.state !== was) {
      if (CLOSED_INITIATIVE.includes(w.state)) {
        Object.assign(data, { result: RESULT_DB_OF[w.state], resultNote: w.result ?? p.x.result, closedAt: now });
        changes.push({ initiativeId: id, kind: "close", note: `${RESULT_WORDS[w.state]}: ${w.result ?? p.x.result ?? ""}`, byId: actor.personId, at: now });
      } else {
        if (cur.closedAt) {
          Object.assign(data, { result: null, resultNote: null, closedAt: null });
          changes.push({ initiativeId: id, kind: "reopen", byId: actor.personId, at: now });
        }
        Object.assign(data, { state: STATE_DB_OF[w.state], stateSince: now });
        changes.push({ initiativeId: id, kind: "state", fromState: cur.state, toState: STATE_DB_OF[w.state], note: p.x.note || null, byId: actor.personId, at: now });
      }
    } else if ("result" in w && cur.closedAt) data.resultNote = w.result;
    if (Object.keys(data).length) {
      await tx.initiative.update({ where: { id }, data });
      await tx.initiativeChange.createMany({ data: changes });
      await audit("initiative.edit", id, (w.title as string | undefined) ?? cur.title, "обновлена из пакета наполнения");
    }
    const kept = { ...p.kept, ...(goalId !== undefined ? { goalId } : {}) };
    await remember(tx, "initiative", x.key, id, x, kept);
    done += 1;
  }
  return done;
}
