// Сборка выдуманных данных относительно сегодняшней даты: просрочки и сроки всегда выглядят живыми.

import { addDays, type IsoDate } from "./dates";
import { statusOf } from "./dictionaries";
import { ENTRY_SEEDS, HEADLINES } from "./seed-weekly";
import { TASK_SEEDS } from "./seed-tasks";
import type { HistoryItem, JournalEvent, PersonSlug, PersonWeekly, Task, Transfer, WeeklyEntry } from "./types";

export type PrototypeData = {
  today: IsoDate;
  reportingWeek: number;
  tasks: Task[];
  weeklies: PersonWeekly[];
  entries: WeeklyEntry[];
  journal: JournalEvent[];
};

const TIMES = ["09:12", "10:40", "11:05", "12:30", "14:18", "15:47", "16:20", "17:55", "18:34"];
const timeFor = (n: number) => TIMES[n % TIMES.length]!;

function buildTask(seed: (typeof TASK_SEEDS)[number], today: IsoDate): Task {
  const due = addDays(today, seed.due);
  const shift = (seed.transfers ?? []).reduce((s, t) => s + t.days, 0);
  const originalDue = addDays(due, -shift);
  const createdAt = addDays(today, -(seed.created ?? 14));
  const createdBy = seed.createdBy ?? (seed.owner === "all" ? "golovkin" : seed.owner === "muradyan" ? "muradyan" : "golovkin");

  const transfers: Transfer[] = [];
  let cursor = originalDue;
  (seed.transfers ?? []).forEach((t, i) => {
    const to = addDays(cursor, t.days);
    transfers.push({ from: cursor, to, by: t.by, reason: t.reason, at: addDays(cursor, -2 - i) });
    cursor = to;
  });

  const history: HistoryItem[] = [
    { id: `${seed.n}-h0`, at: createdAt, time: timeFor(seed.n), by: createdBy, field: "Задача создана", after: seed.title },
  ];
  transfers.forEach((t, i) =>
    history.push({
      id: `${seed.n}-t${i}`,
      at: t.at,
      time: timeFor(seed.n + i + 1),
      by: t.by,
      field: "Срок",
      before: t.from,
      after: `${t.to}. Причина: ${t.reason}`,
    }),
  );
  if (seed.closed !== undefined) {
    history.push({
      id: `${seed.n}-c`,
      at: addDays(today, -seed.closed),
      time: timeFor(seed.n + 3),
      by: seed.owner === "all" ? "golovkin" : seed.owner,
      field: "Статус",
      before: "В работе",
      after: statusOf(seed.st).label,
    });
  }
  if (seed.state && seed.state !== "on-track") {
    history.push({
      id: `${seed.n}-s`,
      at: addDays(today, -(seed.updated ?? 3)),
      time: timeFor(seed.n + 5),
      by: seed.owner === "all" ? "golovkin" : seed.owner,
      field: "Состояние",
      before: "В графике",
      after: seed.state === "blocked" ? "Заблокирована" : "Есть риск",
    });
  }
  history.sort((a, b) => (a.at + a.time < b.at + b.time ? 1 : -1));

  return {
    number: seed.n,
    title: seed.title,
    outcome: seed.outcome,
    owner: seed.owner,
    coExecutors: seed.co ?? [],
    direction: seed.dir,
    priority: seed.pr,
    status: seed.st,
    state: seed.state ?? "on-track",
    blockedBy: seed.blockedBy,
    where: seed.where,
    whereUpdatedAt: addDays(today, -(seed.updated ?? 3)),
    due,
    originalDue,
    transfers,
    source: seed.source ?? { kind: "meeting", note: "Встреча команды" },
    links: seed.links ?? [],
    comments: (seed.comments ?? []).map((c, i) => ({
      id: `${seed.n}-k${i}`,
      author: c.a,
      text: c.t,
      at: addDays(today, -c.ago),
      time: c.time ?? timeFor(seed.n + i),
    })),
    history,
    createdBy,
    createdAt,
    updatedAt: addDays(today, -(seed.updated ?? 3)),
    closedAt: seed.closed !== undefined ? addDays(today, -seed.closed) : undefined,
    resolution: seed.resolution,
  };
}

function buildJournal(tasks: Task[], weeklies: PersonWeekly[], today: IsoDate, reportingWeek: number): JournalEvent[] {
  const events: JournalEvent[] = [];
  for (const t of tasks) {
    for (const h of t.history) {
      events.push({
        id: `j-${h.id}`,
        at: h.at,
        time: h.time,
        by: h.by,
        source: "app",
        kind: "task",
        object: `Задача ${t.number}`,
        field: h.field,
        before: h.before,
        after: h.after,
      });
    }
    for (const c of t.comments) {
      events.push({ id: `j-${c.id}`, at: c.at, time: c.time, by: c.author, source: "app", kind: "comment", object: `Задача ${t.number}`, field: "Комментарий", after: c.text });
    }
  }
  weeklies
    .filter((w) => w.state === "submitted" || w.state === "late")
    .forEach((w, i) => {
      const daysAgo = (reportingWeek - w.week) * 7 + (w.state === "late" ? -1 : 0);
      events.push({
        id: `j-w-${w.week}-${w.author}`,
        at: addDays(today, -Math.max(0, daysAgo)),
        time: timeFor(i),
        by: w.author,
        source: "app",
        kind: "weekly",
        object: `Weekly за неделю ${w.week}`,
        field: "Состояние",
        before: "Черновик",
        after: w.state === "late" ? "Сдан с опозданием" : "Сдан",
      });
    });
  const logins: [PersonSlug, number][] = [["muradyan", 0], ["golovkin", 0], ["reva", 1], ["fatyanov", 1], ["cheychenets", 2]];
  logins.forEach(([who, ago], i) =>
    events.push({ id: `j-l${i}`, at: addDays(today, -ago), time: timeFor(i + 2), by: who, source: "app", kind: "login", object: "Вход в ресурс", after: "Успешно" }),
  );
  events.push({ id: "j-l-fail", at: today, time: "08:03", by: "system", source: "system", kind: "login", object: "Вход в ресурс", after: "Неверный пароль" });
  events.push({ id: "j-s1", at: addDays(today, -1), time: "03:00", by: "system", source: "system", kind: "sync", object: "Сверка таблицы", after: "Расхождений нет" });
  events.push({
    id: "j-s2", at: addDays(today, -3), time: "03:00", by: "system", source: "sheet", kind: "sync", object: "Задача 21",
    field: "Статус", before: "Требует уточнений (правка в таблице)", after: "В работе (вернули значение ресурса)",
  });
  events.push({ id: "j-set", at: addDays(today, -5), time: "12:10", by: "muradyan", source: "app", kind: "settings", object: "Настройки", field: "Порог «давно не обновлялась»", before: "10 дней", after: "14 дней" });

  return events.sort((a, b) => (a.at + a.time < b.at + b.time ? 1 : -1));
}

export function buildPrototypeData(today: IsoDate, reportingWeek: number): PrototypeData {
  const tasks = TASK_SEEDS.map((s) => buildTask(s, today));
  const weeklies: PersonWeekly[] = HEADLINES.map((h) => ({
    week: reportingWeek - h.w,
    author: h.a,
    headline: h.headline,
    state: h.state,
    submittedAt: h.at,
  }));
  const entries: WeeklyEntry[] = ENTRY_SEEDS.map((e, i) => ({
    id: `e${i + 1}`,
    week: reportingWeek - e.w,
    author: e.a,
    direction: e.dir,
    block: e.block,
    type: e.type,
    what: e.what,
    details: e.details,
    impact: e.impact,
    next: e.next,
    help: e.help,
    links: e.links ?? [],
    ceo: e.ceo ?? false,
    taskNumber: e.task,
  }));
  return { today, reportingWeek, tasks, weeklies, entries, journal: buildJournal(tasks, weeklies, today, reportingWeek) };
}
