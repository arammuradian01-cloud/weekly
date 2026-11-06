// Правила weekly из разделов 2 и 3 ТЗ. Чистые функции: ими пользуются сервер и экраны.

import type { PersonSlug, WeekInfo, WeekKey } from "@/domain/types";
import type { Viewer } from "@/lib/tasks/rules";

export const WEEKLY_LIMITS = { headline: 150, what: 150, details: 1000, impact: 500, fact: 300, next: 500, help: 300, linkTitle: 120, url: 500 };

/**
 * Кто правит weekly недели: свой weekly пишет каждый, кроме наблюдателя, пока неделя открыта
 * и не позже отчётной. Чужой weekly и закрытую неделю правят только владелец и администраторы
 */
export function canEditWeekly(week: Pick<WeekInfo, "key" | "closed">, reportingKey: WeekKey, viewer: Viewer, author: PersonSlug | null): boolean {
  if (viewer.observer) return false;
  if (viewer.management) return true;
  if (week.closed || week.key > reportingKey) return false;
  return author === viewer.slug;
}

/** Сдан вовремя или с опозданием: сравниваем момент сдачи со сроком недели */
export function submitState(now: Date, deadline: Date): "submitted" | "late" {
  return now.getTime() <= deadline.getTime() ? "submitted" : "late";
}

// ---------- Weekly за прошлые недели (этап 73+81) ----------
//
// Сервер и раньше разрешал писать свой weekly за прошлую неделю, пока она открыта (canEditWeekly), а экран сдачи всегда
// брал отчётную неделю. Здесь то, что нужно экрану сдачи для любой недели. Права не меняются: закрытая неделя остаётся
// только для владельца и администраторов, как было.

/** Сколько недель в переключателе экрана сдачи: отчётная и прошлые. Более старые открываются стрелкой или адресом */
export const SUBMIT_WEEKS = 8;

/**
 * Неделя экрана сдачи по адресу (?week=<понедельник>). Нет недели или она не понедельник: отчётная. Будущая: тоже
 * отчётная, и экран говорит, что за будущую неделю weekly не пишут. earliest: самая старая неделя, которую ресурс
 * вёл; неделя раньше неё заменяется ею, иначе открытие недели заводило бы в базе недели, которых никогда не было
 */
export function submitWeekOf(
  wanted: unknown,
  reporting: WeekKey,
  isKey: (v: unknown) => v is WeekKey,
  earliest?: WeekKey | null,
): { key: WeekKey; future: boolean; tooOld: boolean } {
  if (!isKey(wanted)) return { key: reporting, future: false, tooOld: false };
  if (wanted > reporting) return { key: reporting, future: true, tooOld: false };
  if (earliest && wanted < earliest) return { key: earliest, future: false, tooOld: true };
  return { key: wanted, future: false, tooOld: false };
}

/** Состояние недели в переключателе: сдан, сдан с опозданием, черновик, не сдан; закрытая неделя поверх любого */
export type SubmitWeekState = "submitted" | "late" | "draft" | "not-started" | "closed";

export function submitWeekState(state: "submitted" | "late" | "draft" | "not-started", closed: boolean): SubmitWeekState {
  if (closed && state !== "submitted" && state !== "late") return "closed";
  return state;
}

export const SUBMIT_WEEK_LABEL: Record<SubmitWeekState, string> = {
  submitted: "сдан",
  late: "сдан с опозданием",
  draft: "черновик",
  "not-started": "не сдан",
  closed: "закрыта",
};

/** Момент по Москве для подсказок: «20 октября, 18:05» */
export function moscowMoment(iso: string): string {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" в ", ", ");
}

/** Отчёт руководителю (или отчёт команды), куда идут записи автора, уже отправлен за эту неделю */
export type SentReportNote = { team: string; at: string; to: string[] };

/**
 * Предупреждение при сдаче weekly за неделю, отчёт руководителю за которую уже ушёл: записи попадут в ленту и в отчёт
 * команды, но в отправленную версию сами не войдут. Пусто: предупреждать не о чем
 */
export function sentReportsWarning(list: readonly SentReportNote[], weekNumber: number): string | null {
  if (!list.length) return null;
  const parts = list.map((r) => `команда «${r.team}», ${moscowMoment(r.at)}${r.to.length ? `, получил ${r.to.join(", ")}` : ""}`);
  const head = list.length === 1 ? `Отчёт руководителю за неделю ${weekNumber} уже отправлен` : `Отчёты руководителю за неделю ${weekNumber} уже отправлены`;
  return `${head} (${parts.join("; ")}). Записи попадут в ленту и в отчёт команды, но в отправленную версию сами не войдут: при необходимости отчёт отправят ещё раз.`;
}

/**
 * Кто закрыл неделю и кто может её открыть: подсказка автору, который открыл свой weekly за закрытую неделю.
 * teams: команды, которые ждут его weekly и закрыли неделю, с их руководителями
 */
export function closedWeekHint(weekNumber: number, department: boolean, teams: readonly { name: string; leader: string | null }[]): string {
  if (department || !teams.length) return `Неделя ${weekNumber} закрыта после встречи: записи правят только владелец и администраторы. Открыть неделю может владелец или администратор в режиме управления.`;
  const names = teams.map((t) => `«${t.name}»${t.leader ? ` (${t.leader})` : ""}`).join(", ");
  return teams.length === 1
    ? `Неделю ${weekNumber} закрыл руководитель команды ${names}. Открыть её может руководитель этой команды или руководитель выше, а также владелец и администраторы.`
    : `Неделю ${weekNumber} закрыли руководители команд ${names}. Открыть её могут руководители этих команд или руководители выше, а также владелец и администраторы.`;
}

export type CeoSections = { main: string; risks: string; next: string };

/** Длинное тире и стрелки в отчёте CEO заменяются на дефис автоматически (раздел 3 ТЗ и правило текстов Арама) */
export function cleanDash(text: string): string {
  return text.replace(/[—–→⟶⇒]/g, "-");
}

/** Числа текста: «20 700» и «20700» одно и то же */
function numbersIn(text: string): string[] {
  return text.replace(/(\d)[\s\u00a0](?=\d{3}(?!\d))/g, "$1").match(/\d+(?:[.,]\d+)?/g) ?? [];
}

/** «Цифра или факт» повторяет то, что уже сказано: все её числа есть в тексте записи. Тогда в отчёт её не дописываем */
export function repeatsNumbers(extra: string, text: string): boolean {
  const own = numbersIn(extra);
  if (!own.length) return false;
  const have = new Set(numbersIn(text));
  return own.every((n) => have.has(n));
}

/** Что произошло: первая фраза текста. Длинную режем по слову до 150 знаков, полный текст уходит в «Подробнее» */
export function splitWhat(text: string): { what: string; details?: string } {
  const value = text.trim();
  const first = /^(.+?[.!?])(\s|$)/s.exec(value)?.[1] ?? value;
  if (first.length <= WEEKLY_LIMITS.what) {
    const rest = value.slice(first.length).trim();
    return { what: first, details: rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : undefined };
  }
  const cut = first.slice(0, WEEKLY_LIMITS.what - 1);
  const atSpace = cut.lastIndexOf(" ");
  return { what: `${(atSpace > 80 ? cut.slice(0, atSpace) : cut).replace(/[,;:\s]+$/, "")}…`, details: value };
}
