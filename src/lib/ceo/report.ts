// Отчёт CEO по смысловым блокам (этап 66): сохранение блоков, отправка CEO и отчёт глазами CEO. Отправка как в этапе 61:
// только в приложении, отчёт недели сохраняется и помечается отправленным (кто, когда, кому) со снимком, CEO получает
// событие в «Мне» и видит собранный отчёт на странице «Отчёт CEO». Отправить может владелец или администратор в режиме
// управления при личном входе: CEO должен видеть настоящего автора, а отчёт CEO за неделю у департамента один.
//
// Блоки хранятся рядом с прежними разделами: главное, риски и что дальше собираются из блоков при каждом сохранении, их
// читают выгрузка в Excel и старые экраны. Старые отчёты (только разделы) показываются как раньше.

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
import type { WeekKey } from "@/domain/types";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import { dbDate, isoFromDbDate } from "@/lib/tasks/dates";
import { notify } from "@/lib/inbox/notify";
import { audit, getCeoReport, weekContext, type CeoReportView } from "@/lib/weekly/service";
import type { CeoSections } from "@/lib/weekly/rules";
import { assembleCeoBlocks, blocksMeta, type BlocksMeta } from "@/lib/weekly-blocks/sources";
import { blocksForLevel, blocksToLegacy, cleanBlocks, hasBlocksText, lineText, orderedLines, sentBlocks, withLiveBlocks, type ReportBlock } from "@/lib/weekly-blocks/types";
import { cleanMeetings, type CeoMeeting } from "./text";
import { ceoContext, type CeoContext } from "./assembled";
import { TOP_TEAM } from "@/lib/org/scope";

type Tx = Prisma.TransactionClient;

const fail = (message: string): never => {
  throw new TaskRuleError(message);
};

export const personalLogin = (actor: Pick<Actor, "via">) => actor.via !== "TEAM";
/** Отправить из разбора встречи (этап 61): владелец или администратор в режиме управления при личном входе */
export const canSendCeo = (actor: Pick<Actor, "via" | "management">) => personalLogin(actor) && (actor.management === "OWNER" || actor.management === "ADMIN");

/**
 * Кто ведёт отчёт руководителю команды страхования и инвестиций, бывший отчёт CEO (этап 73): владелец и администраторы
 * в режиме управления, как раньше, и руководитель этой команды при личном входе: каждый руководитель делает weekly для
 * своего руководителя
 */
export async function canEditTop(actor: Actor, db: Tx | typeof prisma = prisma): Promise<boolean> {
  if (actor.role === "OBSERVER") return false;
  if (actor.management === "OWNER" || actor.management === "ADMIN") return true;
  if (!personalLogin(actor)) return false;
  const top = await db.team.findUnique({ where: { id: TOP_TEAM }, select: { leaderId: true, active: true } });
  return !!top?.active && top.leaderId === actor.personId;
}

/** Отправить отчёт руководителю команды страхования и инвестиций: тот, кто его ведёт, при личном входе */
export async function canSendTop(actor: Actor): Promise<boolean> {
  return personalLogin(actor) && (await canEditTop(actor));
}

export const TOP_EDIT_TEXT = "Отчёт руководителю этой команды ведут её руководитель при личном входе, владелец и администраторы в режиме управления";

async function requireEdit(actor: Actor, db: Tx | typeof prisma = prisma) {
  if (!(await canEditTop(actor, db))) fail(TOP_EDIT_TEXT);
}

// ---------- Кто CEO ----------

/**
 * Кому уходит weekly для CEO: руководитель подразделения уровня «компания» (корень структуры, этап 53). Если его нет,
 * включённый профиль CEO из стартовых людей (короткое имя ceo)
 */
export async function ceoRecipients(db: Tx | typeof prisma = prisma): Promise<{ id: string; slug: string; fullName: string }[]> {
  const company = await db.orgUnit.findFirst({
    where: { kind: "COMPANY", active: true, headId: { not: null } },
    orderBy: { createdAt: "asc" },
    select: { head: { select: { id: true, slug: true, fullName: true, active: true } } },
  });
  if (company?.head?.active) return [{ id: company.head.id, slug: company.head.slug, fullName: company.head.fullName }];
  return db.person.findMany({ where: { slug: "ceo", active: true }, select: { id: true, slug: true, fullName: true } });
}

export async function isCeo(personId: string): Promise<boolean> {
  return (await ceoRecipients()).some((p) => p.id === personId);
}

// ---------- Сохранение блоков ----------

/** Блок одной строкой для журнала: было и стало */
const blockLog = (b: ReportBlock | undefined, meta: BlocksMeta) => (b ? `${b.hidden ? "Скрыт. " : ""}${orderedLines(b, meta.order).map((l) => `- ${lineText(l, meta.labels)}`).join("\n")}` : "");
const meetingsText = (list: CeoMeeting[]) => list.map((m) => `${m.title || "Встреча"}: ${m.text}`).join("\n\n");

/**
 * Сохранить отчёт CEO по блокам внутри транзакции. meetings: «Мои встречи недели»; не передали: остаются прежние.
 * expected: момент прошлого сохранения, который видел экран (null: отчёт ещё не сохраняли). Кто-то сохранил позже:
 * ошибка, а не тихая перезапись
 */
export async function saveCeoBlocksIn(tx: Tx, actor: Actor, key: WeekKey, input: unknown, meetings: unknown, expected: string | null | undefined, meta?: BlocksMeta): Promise<CeoReportView> {
  await requireEdit(actor, tx);
  const m = meta ?? (await blocksMeta());
  const blocks = cleanBlocks(input, new Set(m.order));
  if (!blocks.length) fail("В отчёте нет ни одного блока: обновите страницу");
  const { row } = await weekContext(tx, key);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ceo-report:${key}`}))`;
  const before = await tx.ceoReport.findUnique({ where: { weekId: row.id } });
  if (expected !== undefined && (before?.updatedAt.toISOString() ?? null) !== (expected ?? null)) {
    fail("Отчёт за эту неделю уже сохранён с другого устройства или другим человеком. Скопируйте свои правки и обновите страницу, чтобы не затереть чужие");
  }
  const list = Array.isArray(meetings) ? cleanMeetings(meetings) : cleanMeetings(before?.meetings ?? []);
  const legacy = blocksToLegacy(blocks, m.labels, m.order);
  const data = { ...legacy, blocks: blocks as unknown as Prisma.InputJsonValue, meetings: list, updatedById: actor.personId };
  const saved = await tx.ceoReport.upsert({ where: { weekId: row.id }, update: data, create: { ...data, weekId: row.id } });
  // Журнал: было и стало по каждому блоку, который поменялся, порядок блоков и встречи
  const old = Array.isArray(before?.blocks) ? cleanBlocks(before!.blocks, null) : null;
  const changes: [string, string | null, string][] = [];
  if (!old && before) changes.push(["переведён в блоки", `${before.main}\n${before.risks}\n${before.next}`.trim() || null, blocks.map((b) => b.title).join(", ")]);
  for (const b of blocks) {
    const prev = old?.find((x) => x.key === b.key);
    const a = blockLog(b, m);
    const p = old ? blockLog(prev, m) : null;
    if ((p ?? "") !== a) changes.push([`блок «${b.title}»`, p || null, a]);
  }
  if (old && old.map((b) => b.key).join(",") !== blocks.map((b) => b.key).join(",")) changes.push(["порядок блоков", old.map((b) => b.title).join(", "), blocks.map((b) => b.title).join(", ")]);
  const meetingsBefore = before ? meetingsText(cleanMeetings(before.meetings)) : null;
  if ((meetingsBefore ?? "") !== meetingsText(list)) changes.push(["мои встречи недели", meetingsBefore, meetingsText(list)]);
  for (const [part, b, a] of changes) await audit(tx, actor, "ceo.save", "ceo-report", key, `Отчёт CEO, ${part}`, b || null, a || null);
  if (!changes.length) await audit(tx, actor, "ceo.save", "ceo-report", key, "Отчёт CEO сохранён без изменений", null, null);
  return { sections: legacy, blocks, meetings: list, updatedBy: actor.fullName, updatedAt: saved.updatedAt.toISOString() };
}

export async function saveCeoBlocks(actor: Actor, key: WeekKey, blocks: unknown, meetings: unknown, expected: string | null | undefined): Promise<CeoReportView> {
  await requireEdit(actor);
  const meta = await blocksMeta();
  return prisma.$transaction((tx) => saveCeoBlocksIn(tx, actor, key, blocks, meetings, expected, meta));
}

// ---------- Отправка ----------

/** Что ушло CEO: прежние разделы, встречи и (с этапа 66) блоки в момент отправки */
export type CeoSnapshot = CeoSections & { meetings: CeoMeeting[]; blocks: ReportBlock[] | null };

export function snapshotOf(value: unknown): CeoSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  return { main: String(v.main ?? ""), risks: String(v.risks ?? ""), next: String(v.next ?? ""), meetings: cleanMeetings(v.meetings), blocks: Array.isArray(v.blocks) ? cleanBlocks(v.blocks, null) : null };
}

/**
 * Пометить сохранённый отчёт недели отправленным: кто, когда, кому и снимок того, что действительно сохранилось.
 * Момент отправки тот же, что момент записи отчёта: правка после отправки видна по более позднему updatedAt. Запрос
 * мимо Prisma, иначе @updatedAt сдвинулся бы ещё раз. CEO получает событие в «Мне»
 */
export async function markCeoSentIn(tx: Tx, actor: Actor, key: WeekKey, saved: CeoReportView, recipients: { id: string; fullName: string }[], text: string, now = new Date()): Promise<{ id: string; name: string }[]> {
  const week = await tx.week.findUniqueOrThrow({ where: { start: dbDate(key) }, select: { id: true } });
  const to = recipients.map((r) => ({ id: r.id, name: r.fullName }));
  // В снимке только видимые блоки: скрытый блок CEO не уходит, в данные его страницы тоже
  const snapshot: CeoSnapshot = { ...(saved.sections ?? { main: "", risks: "", next: "" }), meetings: saved.meetings, blocks: saved.blocks ? sentBlocks(saved.blocks) : null };
  await tx.$executeRaw`UPDATE ceo_reports SET "sentAt" = "updatedAt", "sentById" = ${actor.personId}, "sentTo" = ${JSON.stringify(to)}::jsonb, "sentSnapshot" = ${JSON.stringify(snapshot)}::jsonb WHERE "weekId" = ${week.id}`;
  await notify(tx, { kind: "MEETING", recipients: recipients.map((r) => r.id), actor, subject: `ceo-report:${key}`, text }, now);
  return to;
}

export type SendCeoReportInput = { blocks: unknown; meetings?: unknown; expected: string | null };

/**
 * Отправить CEO отчёт недели со страницы «Отчёт CEO»: сохранить блоки и пометить отправленным одной транзакцией. Цифры
 * недели и месяца, которые не правили руками, уходят свежими: автосборка считается в момент отправки
 */
export async function sendCeoReport(actor: Actor, key: WeekKey, input: SendCeoReportInput, now = new Date()): Promise<CeoReportView> {
  await requireEdit(actor);
  if (!personalLogin(actor)) fail("Отправить руководителю можно при личном входе: так получатель видит, кто отправил");
  const meta = await blocksMeta();
  const clean = cleanBlocks(input?.blocks, new Set(meta.order));
  if (!hasBlocksText(clean)) fail("Weekly для CEO пустой: в видимых блоках нет ни одной строки");
  const recipients = await ceoRecipients();
  if (!recipients.length) fail("Не найден CEO: назначьте руководителя компании в «Структуре» или включите профиль CEO в «Людях»");
  // Свежая автосборка до транзакции: она читает много таблиц
  const blocks = withLiveBlocks(clean, (await assembleCeoBlocks(actor, key, now)).blocks);
  await prisma.$transaction(
    async (tx) => {
      const saved = await saveCeoBlocksIn(tx, actor, key, blocks, input.meetings, input.expected ?? null, meta);
      const week = await weekContext(tx, key);
      const to = await markCeoSentIn(tx, actor, key, saved, recipients, `${actor.fullName} отправил weekly для CEO за неделю ${week.info.number}`, now);
      await audit(tx, actor, "ceo.send", "ceo-report", key, `Weekly для CEO, неделя ${week.info.number}`, null, `Отправлен в приложении: ${to.map((t) => t.name).join(", ")}`);
    },
    { timeout: 30_000 },
  );
  // Отчёт недели после отправки: с отметкой «отправлен»
  return getCeoReport(key);
}

// ---------- Отчёт CEO глазами CEO ----------

export type CeoInboxView = {
  weeks: { key: WeekKey; number: number; sentAt: string }[];
  current: {
    key: WeekKey;
    number: number;
    /** Что ушло CEO: снимок разделов, блоков и встреч в момент отправки */
    sections: CeoSections;
    blocks: ReportBlock[] | null;
    meetings: CeoMeeting[];
    sentAt: string;
    sentBy: string | null;
    /** После отправки отчёт правили в приложении: CEO видит отправленную версию */
    editedAfter: boolean;
    ctx: CeoContext;
    /** Подписи продуктов для строк блоков */
    labels: Record<string, string>;
    order: string[];
  } | null;
};

/**
 * Отправленные CEO отчёты для CEO: только чтение и только при личном входе. Неделя не задана или не отправлена:
 * последняя отправленная. Цифры, решения и благодарности собираются живыми за ту неделю, цифры по уровню зрителя. Строки
 * блоков с цифрами тоже по уровню: запасной профиль CEO или другой получатель без доступа к цифрам видит вместо них
 * «Цифры видны только с доступом к цифрам», и прежние разделы для него собираются из уже урезанных блоков
 */
export async function ceoSentReports(actor: Actor, key?: string | null): Promise<CeoInboxView | null> {
  if (!personalLogin(actor)) return null;
  const ceo = await isCeo(actor.personId);
  const rows = await prisma.ceoReport.findMany({
    where: { sentAt: { not: null } },
    include: { week: { select: { start: true, isoNumber: true } }, sentBy: { select: { fullName: true } } },
    orderBy: { week: { start: "desc" } },
    take: 30,
  });
  const mine = rows.filter((r) => ceo || (Array.isArray(r.sentTo) && (r.sentTo as { id?: string }[]).some((t) => t?.id === actor.personId)));
  if (!ceo && !mine.length) return null;
  const pick = mine.find((r) => isoFromDbDate(r.week.start) === key) ?? mine[0] ?? null;
  let current: CeoInboxView["current"] = null;
  if (pick) {
    const snap = snapshotOf(pick.sentSnapshot) ?? { main: pick.main, risks: pick.risks, next: pick.next, meetings: cleanMeetings(pick.meetings), blocks: Array.isArray(pick.blocks) ? cleanBlocks(pick.blocks, null) : null };
    const week = isoFromDbDate(pick.week.start) as WeekKey;
    const [meta, ctx] = await Promise.all([blocksMeta(), ceoContext(actor, week, { recipient: true })]);
    const blocks = snap.blocks ? blocksForLevel(sentBlocks(snap.blocks), ctx.level) : null;
    current = {
      key: week,
      number: pick.week.isoNumber,
      // Разделы для тех, кто видит не все цифры, из урезанных блоков: в разделах те же строки текстом
      sections: blocks && ctx.level !== "full" ? blocksToLegacy(blocks, meta.labels, meta.order) : { main: snap.main, risks: snap.risks, next: snap.next },
      blocks,
      meetings: snap.meetings,
      sentAt: pick.sentAt!.toISOString(),
      sentBy: pick.sentBy?.fullName ?? null,
      editedAfter: pick.updatedAt.getTime() > pick.sentAt!.getTime(),
      ctx,
      labels: meta.labels,
      order: meta.order,
    };
  }
  return { weeks: mine.map((r) => ({ key: isoFromDbDate(r.week.start) as WeekKey, number: r.week.isoNumber, sentAt: r.sentAt!.toISOString() })), current };
}
