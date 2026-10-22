// Weekly-команды (этап 64): чистые правила экрана без базы. Их считают и сервер (что показать человеку), и экран
// (поиск, ветка, итог добавления), и тесты. Решает по-прежнему сервер: сервисы команд и проектов проверяют права
// при каждом действии, здесь только подсказка экрану, какие кнопки показывать, по тем же правилам.

import { TOP_TEAM } from "@/domain/teams";
import { plural } from "@/domain/dates";

/** Кто смотрит. owner: владелец в режиме управления (canManagePeople). personal: не общий логин без режима управления и не наблюдатель */
export type RightsSubject = { me: string; owner: boolean; personal: boolean; leads: ReadonlySet<string> };

export type RightsTeam = { id: string; leaderId: string | null; project: boolean; active: boolean };

export type TeamRights = {
  /** Добавить и убрать участников (addProjectPeople, removeTeamMember) */
  members: boolean;
  /** Переименовать: свой проект руководитель, любую команду владелец (renameProject, updateTeam) */
  rename: boolean;
  /** Закрыть: свой проект руководитель, любую, кроме топ-команды, владелец (closeProject, updateTeam) */
  close: boolean;
  /** Руководитель и команда выше: владелец в режиме управления (updateTeam) */
  leader: boolean;
  /** Ритм weekly: руководитель команды и руководитель выше, владелец (setTeamRhythm) */
  rhythm: boolean;
};

export const NO_RIGHTS: TeamRights = { members: false, rename: false, close: false, leader: false, rhythm: false };

/** Права на команду по правилам сервисов: requireTeamEditor и addIn, ownProject, updateTeam, setTeamRhythm */
export function teamRights(s: RightsSubject, t: RightsTeam): TeamRights {
  if (!t.active) return NO_RIGHTS;
  const mine = s.personal && t.leaderId === s.me;
  return {
    members: s.owner || (mine && t.id !== TOP_TEAM),
    rename: s.owner || (mine && t.project),
    close: (s.owner && t.id !== TOP_TEAM) || (mine && t.project),
    leader: s.owner,
    rhythm: t.id !== TOP_TEAM && (s.owner || (s.personal && s.leads.has(t.id))),
  };
}

/** Запрос в команду отменяет тот, кто просил, руководитель команды или владелец (cancelJoinRequest); общий логин нет */
export function canCancelRequest(s: Pick<RightsSubject, "me" | "owner" | "personal">, team: { leaderId: string | null }, requestedById: string | null): boolean {
  if (s.owner) return true;
  if (!s.personal) return false;
  return requestedById === s.me || team.leaderId === s.me;
}

/** Строка поиска: регистр, ё и лишние пробелы не важны */
export const teamSearchKey = (text: string) => text.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

export type SearchableTeam = { name: string; leader: { fullName: string } | null; members: { fullName: string }[]; waiting?: { fullName: string }[] };

/** Подходит ли команда под запрос: каждое слово есть в названии, у руководителя, участников или ждущих согласия */
export function matchTeam(team: SearchableTeam, query: string): boolean {
  const words = teamSearchKey(query).split(" ").filter(Boolean);
  if (!words.length) return true;
  const hay = teamSearchKey([team.name, team.leader?.fullName ?? "", ...team.members.map((m) => m.fullName), ...(team.waiting ?? []).map((w) => w.fullName)].join(" "));
  return words.every((w) => hay.includes(w));
}

/** Вид команды для экрана: по структуре (команды подразделений и топ-команда) или проект (собранная руками) */
export function teamKindLabel(team: { kind: "TOP" | "UNIT" | "CUSTOM" }): "По структуре" | "Проект" {
  return team.kind === "CUSTOM" ? "Проект" : "По структуре";
}

/**
 * Человек из ветки руководителя: руководитель выше по цепочке подчинения. Так же считает сервер (addIn, inBranch);
 * экрану это нужно только для пометки «другая ветка», решение о согласии всё равно принимает сервер
 */
export function inBranch(managerOf: ReadonlyMap<string, string | null>, slug: string, leader: string | null): boolean {
  if (!leader) return false;
  const seen = new Set<string>();
  for (let cur = managerOf.get(slug) ?? null; cur && !seen.has(cur); cur = managerOf.get(cur) ?? null) {
    if (cur === leader) return true;
    seen.add(cur);
  }
  return false;
}

export type AddResult = { added: string[]; requested: { name: string; approver: string }[]; already: string[]; skipped: { name: string; reason: string }[] };

/** Итог добавления людей одной строкой для уведомления */
export function addSummary(name: string, r: AddResult | null): string {
  if (!r) return `Команда «${name}» создана`;
  const parts = [`добавлено ${r.added.length}`];
  if (r.requested.length) parts.push(`ждут согласия руководителя ${r.requested.length}`);
  if (r.already.length) parts.push(`уже были в команде или ждут согласия ${r.already.length}`);
  if (r.skipped.length) parts.push(`не добавлено ${r.skipped.length}: ${r.skipped.slice(0, 2).map((s) => s.reason).join("; ")}`);
  return `Команда «${name}»: ${parts.join(", ")}`;
}

/** Кем человек приходится команде: руководитель, участник, руководитель команды выше («команда ниже») или никем */
export type TeamRelation = "leader" | "below" | "member" | "other";

/** Порядок списка: свои команды, команды ниже своих, где участник, остальные; внутри порядок дерева команд */
export function sortTeams<T extends { relation: TeamRelation }>(teams: T[]): T[] {
  const rank = { leader: 0, below: 1, member: 2, other: 3 } as const;
  return teams.map((t, i) => ({ t, i })).sort((a, b) => rank[a.t.relation] - rank[b.t.relation] || a.i - b.i).map((x) => x.t);
}

export type WeeklyState = { expected: number; submitted: number; late: number; absent: number; passed: boolean; closed: boolean };

/** Ждём ли weekly и сколько сдали: «не ждём», «все сдали», «срок прошёл», «ждём» */
export function weeklyStatus(w: WeeklyState): "none" | "done" | "overdue" | "waiting" {
  if (w.expected === 0 && w.absent === 0) return "none";
  const done = w.submitted + w.late;
  if (done >= w.expected) return "done";
  return w.passed ? "overdue" : "waiting";
}

/** Сколько человек в команде вместе с руководителем: одно число в строке списка, в карточке и в помощнике */
export function teamSize(team: { leader: unknown | null; members: unknown[] }): number {
  return team.members.length + (team.leader ? 1 : 0);
}

/** «в команде 3 человека»: одно и то же число в строке списка, в карточке и в помощнике, вместе с руководителем */
export const sizeText = (n: number) => `в команде ${n} ${plural(n, "человек", "человека", "человек")}`;

/** Режим управления доступен (владелец или администратор), но выключен: экран объясняет, чего из-за этого не видно */
export type ManagementOff = "owner" | "admin" | null;

/** Подсказка в шапке экрана, когда режим управления доступен, но выключен */
export function managementHint(off: ManagementOff): string | null {
  if (off === "owner") return "Сейчас видны только ваши команды. Включите режим управления, чтобы видеть все команды и назначать руководителей.";
  if (off === "admin") return "Сейчас видны только ваши команды. Включите режим управления, чтобы видеть все команды компании.";
  return null;
}

/**
 * Пояснение в карточке: почему кнопок нет или чего не хватает. manage: рядом ссылка на включение режима управления.
 * Руководителю своей команды не пишем «только просмотр»: у него есть действия, ему объясняем только недостающее
 */
export function teamNote(c: { mode: "all" | "mine" | "shared"; off: ManagementOff }, t: { id: string; relation: TeamRelation; rights: TeamRights; leader?: unknown | null }): { text: string; manage: boolean } | null {
  const r = t.rights;
  if (r.members || r.rename || r.close || r.leader || r.rhythm) {
    if (c.off === "owner" && t.relation === "leader") return { text: "Назначить другого руководителя можно в режиме управления.", manage: true };
    if (t.relation === "below" && !r.members)
      return t.leader
        ? { text: "Команда ниже вашей: вы задаёте, кто сдаёт weekly и срок, состав меняет её руководитель.", manage: false }
        : { text: "Команда ниже вашей: вы задаёте, кто сдаёт weekly и срок. Руководителя у неё нет, состав меняет владелец в режиме управления.", manage: false };
    return null;
  }
  if (c.mode === "shared") return { text: "Под общим входом только просмотр. Чтобы управлять своей командой, войдите со своим логином и паролем.", manage: false };
  if (t.id === TOP_TEAM) return c.off === "owner" ? { text: "Состав этой команды меняют в режиме управления.", manage: true } : { text: "Состав этой команды меняет владелец в режиме управления.", manage: false };
  if (c.off === "owner") return { text: "Чтобы менять эту команду, включите режим управления.", manage: true };
  return { text: "Только просмотр: состав меняют руководитель команды и владелец в режиме управления.", manage: false };
}
