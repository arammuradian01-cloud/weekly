// Матрица прав раздела 2 ТЗ, строка за строкой (критерий приёмки этапа 5).
// Каждая строка проверяется настоящими сервисами на настоящей базе для владельца и администратора в режиме управления,
// лидера, наблюдателя, а также владельца и администратора без режима управления: без пароля управления они действуют как лидеры.
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { importBordTasks } from "@/lib/tasks/bord-import";
import { importBordWeekly } from "@/lib/weekly/bord-import";
import * as tasks from "@/lib/tasks/service";
import * as weekly from "@/lib/weekly/service";
import * as admin from "@/lib/admin/service";
import { canSeeTaskHistory } from "@/lib/tasks/rules";
import { canSeeJournal, canSeeOwnerSections } from "@/lib/roles";
import { moscowToday } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

type Who = "owner" | "admin" | "leader" | "observer" | "ownerPlain" | "adminPlain";
const WHO: Who[] = ["owner", "admin", "leader", "observer", "ownerPlain", "adminPlain"];
const TITLE: Record<Who, string> = {
  owner: "владелец",
  admin: "администратор",
  leader: "лидер",
  observer: "наблюдатель",
  ownerPlain: "владелец без режима управления",
  adminPlain: "администратор без режима управления",
};

const today = moscowToday();
const due = addDays(today, 14);
let seq = 0;

async function actorOf(who: Who): Promise<tasks.Actor> {
  switch (who) {
    case "owner":
      return tasks.actorFor("muradyan", "OWNER");
    case "admin":
      return tasks.actorFor("golovkin", "ADMIN");
    case "ownerPlain":
      return tasks.actorFor("muradyan");
    case "adminPlain":
      return tasks.actorFor("golovkin");
    case "leader":
      return tasks.actorFor("loginova");
    case "observer":
      return { ...(await tasks.actorFor("ceo")), role: "OBSERVER" };
  }
}

/**
 * Разрешено или нет. Отказ должен быть именно отказом по правам: ошибка проверки данных («Напишите…», «Срок…»)
 * значила бы, что тест прошёл не по той причине. Любая другая ошибка роняет тест
 */
const PERMISSION = /режим|владел|администратор|наблюдател|участник|ответственн|соисполнител|только|закрыт|чуж|поставил|предлож|архив/i;
async function allowed(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await fn();
    return true;
  } catch (error) {
    if (!(error instanceof tasks.TaskRuleError)) throw error;
    expect(error.message, `отказ не по правам: «${error.message}»`).toMatch(PERMISSION);
    return false;
  }
}

const newTask = (owner: string, patch: Partial<tasks.NewTaskInput> = {}): tasks.NewTaskInput => ({
  title: `Проверка матрицы ${++seq}`,
  outcome: "Понятно, кто что может",
  owner,
  direction: "osago",
  due,
  ...patch,
});

// Объекты, на которых проверяются строки: создаются заново перед каждым тестом
let fx: {
  rk: string;
  /** Задача, где действующий человек ответственный, поставленная владельцем */
  own: Partial<Record<Who, number>>;
  /** Чужая задача: ответственный Фатьянов */
  foreign: number;
  /** Запись weekly Ревы в отчётной неделе */
  revaEntry: string;
};

async function resetAll() {
  await prisma.task.deleteMany();
  await prisma.weeklyEntry.deleteMany();
  await prisma.weeklyReport.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.week.deleteMany();
  await prisma.setting.update({ where: { key: "tasks.nextNumber" }, data: { value: 52 } });
  await importBordTasks(prisma, readFileSync("data/bord/zadachi-2026-10-05.csv", "utf8"), { batch: "bord-2026-10-05" });
  await importBordWeekly(prisma, readFileSync("data/bord/weekly-ceo-2026-10-05.csv", "utf8"), { batch: "bord-2026-10-05" });
}

beforeAll(async () => {
  await resetAll();
});

beforeEach(async () => {
  const owner = await actorOf("owner");
  const adm = await actorOf("admin");
  const rk = await weekly.currentReportingKey();
  const slugs: Record<Who, string | null> = { owner: "muradyan", admin: "golovkin", ownerPlain: "muradyan", adminPlain: "golovkin", leader: "loginova", observer: null };
  const own: Partial<Record<Who, number>> = {};
  for (const who of WHO) {
    const slug = slugs[who];
    // Задачу ставит не сам человек: иначе «поставил сам» и приоритет ему разрешён по другой строке
    const creator = who === "owner" || who === "ownerPlain" ? adm : owner;
    if (slug) own[who] = (await tasks.createTask(creator, newTask(slug))).task.number;
  }
  const foreign = (await tasks.createTask(owner, newTask("fatyanov"))).task.number;
  // Чужая для всех проверяемых: ставил Рева, ответственный Фатьянов
  const reva = await prisma.person.findUniqueOrThrow({ where: { slug: "reva" } });
  await prisma.task.update({ where: { number: foreign }, data: { createdById: reva.id } });
  await prisma.weeklyEntry.deleteMany({ where: { week: { start: new Date(`${rk}T00:00:00Z`) } } });
  await prisma.week.updateMany({ data: { closedAt: null, closedById: null }, where: { start: new Date(`${rk}T00:00:00Z`) } });
  const revaEntry = (await weekly.saveEntry(await tasks.actorFor("reva"), { week: rk, direction: "product", block: "product", type: "event", what: "Запись Ревы для матрицы прав" })).id;
  fx = { rk, own, foreign, revaEntry };
});

afterAll(async () => {
  await prisma.person.deleteMany({ where: { slug: { startsWith: "matritsa" } } });
  await prisma.$disconnect();
});

/** Шаг строки: подготовка от владельца (должна пройти), потом одно действие от проверяемой роли */
type Step = { name: string; setup?: () => Promise<unknown>; act: () => Promise<unknown> };
type Row = { row: string; expect: [boolean, boolean, boolean, boolean]; steps: (a: tasks.Actor, who: Who) => Step[] };

const ownTask = (who: Who) => fx.own[who] ?? fx.foreign;
const asOwner = () => actorOf("owner");
const entryInput = (patch: Partial<weekly.EntryInput> = {}): weekly.EntryInput => ({ week: fx.rk, direction: "osago", block: "product", type: "event", what: "Своя запись", ...patch });

/**
 * Строки матрицы раздела 2 в том же порядке и с теми же ответами: владелец, администратор, лидер, наблюдатель.
 * «Без режима управления» владелец и администратор получают ответ лидера. Каждый шаг проверяется отдельно
 */
const MATRIX: Row[] = [
  {
    row: "Писать и править свой weekly",
    expect: [true, true, true, false],
    steps: (a) => {
      let id = "";
      return [
        { name: "новая своя запись", act: async () => (id = (await weekly.saveEntry(a, entryInput())).id) },
        {
          name: "правка своей записи",
          // Подготовка: своя запись уже есть (для наблюдателя её создать нельзя, поэтому правит запись Ревы как свою недоступную)
          setup: async () => {
            if (!id) id = a.role === "OBSERVER" ? fx.revaEntry : (await weekly.saveEntry(a, entryInput())).id;
          },
          act: () => weekly.saveEntry(a, entryInput({ id, type: "result", what: "Своя запись, поправлена" })),
        },
        { name: "главное за неделю", act: () => weekly.saveHeadline(a, fx.rk, "Главное за неделю") },
      ];
    },
  },
  {
    row: "Читать weekly всей команды (чтение не зависит от роли)",
    expect: [true, true, true, true],
    steps: () => [{ name: "лента недели", act: async () => expect((await weekly.getWeekView(fx.rk)).entries.some((e) => e.id === fx.revaEntry)).toBe(true) }],
  },
  {
    row: "Править чужой weekly",
    expect: [true, true, false, false],
    steps: (a) => [
      { name: "правка чужой записи", act: () => weekly.saveEntry(a, entryInput({ id: fx.revaEntry, direction: "product", what: "Чужая запись, поправлена" })) },
      { name: "удаление чужой записи", act: () => weekly.deleteEntry(a, fx.revaEntry) },
    ],
  },
  {
    row: "Ставить задачу себе",
    expect: [true, true, true, false],
    steps: (a) => [{ name: "задача себе", act: async () => expect((await tasks.createTask(a, newTask(a.slug))).task.status).toBe("in-progress") }],
  },
  {
    row: "Ставить задачу другому (лидер только предлагает)",
    expect: [true, true, false, false],
    steps: (a) => [
      {
        name: "задача другому сразу в работе",
        act: async () => {
          const r = await tasks.createTask(a, newTask("fatyanov"));
          // Лидер не получает отказ, но задача уходит предложением: в работу её берёт режим управления
          if (r.task.status === "proposed") throw new tasks.TaskRuleError("только предложение");
          expect(r.task.status).toBe("in-progress");
        },
      },
    ],
  },
  {
    row: "Предлагать задачу другому",
    expect: [true, true, true, false],
    steps: (a) => [{ name: "предложение другому", act: () => tasks.createTask(a, newTask("fatyanov")) }],
  },
  {
    row: "Менять статус и состояние своей задачи",
    expect: [true, true, true, false],
    steps: (a, who) => [
      { name: "статус своей", act: () => tasks.changeStatus(a, ownTask(who), "clarify") },
      { name: "состояние своей", act: () => tasks.changeState(a, ownTask(who), "at-risk") },
    ],
  },
  {
    row: "Менять статус и состояние чужой задачи",
    expect: [true, true, false, false],
    steps: (a) => [
      { name: "статус чужой", act: () => tasks.changeStatus(a, fx.foreign, "clarify") },
      { name: "состояние чужой", act: () => tasks.changeState(a, fx.foreign, "at-risk") },
    ],
  },
  {
    row: "Переносить срок своей задачи (с причиной)",
    expect: [true, true, true, false],
    steps: (a, who) => [
      {
        name: "перенос с причиной",
        // Без причины не переносит никто, даже владелец
        setup: async () => expect(tasks.transferDue(await asOwner(), ownTask(who), addDays(due, 7), "")).rejects.toThrow(/причин/i),
        act: () => tasks.transferDue(a, ownTask(who), addDays(due, 7), "Ждём ответа партнёра"),
      },
    ],
  },
  {
    row: "Менять приоритет задачи, которую поставил сам",
    expect: [true, true, true, false],
    steps: (a, who) => {
      let n = 0;
      return [
        {
          name: "приоритет своей постановки",
          // Наблюдатель задач не ставит: для него «своя постановка» это задача, у которой он записан автором
          setup: async () => {
            n = a.role === "OBSERVER" ? ownTask(who) : (await tasks.createTask(a, newTask(a.slug))).task.number;
            if (a.role === "OBSERVER") await prisma.task.update({ where: { number: n }, data: { createdById: a.personId } });
          },
          act: () => tasks.changePriority(a, n, "high"),
        },
      ];
    },
  },
  {
    row: "Менять приоритет задачи, которую поставил другой",
    expect: [true, true, false, false],
    steps: (a, who) => [{ name: "приоритет чужой постановки", act: () => tasks.changePriority(a, ownTask(who), "high") }],
  },
  {
    row: "Комментировать любую задачу",
    expect: [true, true, true, false],
    steps: (a) => [{ name: "комментарий к чужой", act: () => tasks.addComment(a, fx.foreign, "Комментарий для проверки прав") }],
  },
  {
    row: "Удалять задачу (в архив) и возвращать",
    expect: [true, false, false, false],
    steps: (a) => [
      { name: "в архив", act: () => tasks.archiveTask(a, fx.foreign, true) },
      { name: "из архива", setup: async () => (await tasks.getTask(fx.foreign))?.archived || tasks.archiveTask(await asOwner(), fx.foreign, true), act: () => tasks.archiveTask(a, fx.foreign, false) },
    ],
  },
  {
    row: "Отмечать «В отчёт CEO» и собирать отчёт",
    expect: [true, true, false, false],
    steps: (a) => [
      { name: "отметка", act: () => weekly.setCeoFlag(a, fx.revaEntry, true) },
      { name: "отчёт", act: () => weekly.saveCeoReport(a, fx.rk, { main: "- Главное", risks: "", next: "" }) },
    ],
  },
  {
    row: "Открывать и закрывать неделю",
    expect: [true, true, false, false],
    steps: (a) => [
      { name: "закрыть", act: () => weekly.setWeekClosed(a, fx.rk, true) },
      {
        name: "открыть",
        setup: async () => {
          const view = await weekly.getWeekView(fx.rk);
          if (!view.week.closed) await weekly.setWeekClosed(await asOwner(), fx.rk, true);
        },
        act: () => weekly.setWeekClosed(a, fx.rk, false),
      },
    ],
  },
  {
    row: "Справочники (направления, типы записей)",
    expect: [true, true, false, false],
    steps: (a) => {
      let code = "";
      const mk = async () => (code = (await admin.addDictItem(await asOwner(), "DIRECTION", `Проверка прав ${++seq}`)).code);
      return [
        { name: "добавить значение", act: () => admin.addDictItem(a, "DIRECTION", `Проверка прав ${++seq}`) },
        { name: "переименовать значение", setup: mk, act: () => admin.renameDictItem(a, "DIRECTION", code, `Проверка прав ${++seq}`) },
        { name: "скрыть значение", setup: mk, act: () => admin.setDictItemActive(a, "DIRECTION", code, false) },
        { name: "переименовать тип записи", act: () => admin.renameDictItem(a, "ENTRY_TYPE", "plan", `План ${++seq}`) },
      ];
    },
  },
  {
    row: "Ритм недели",
    expect: [true, true, false, false],
    steps: (a) => [{ name: "сохранить ритм", act: async () => admin.saveRhythm(a, { ...(await admin.getRhythm()), staleDays: 20 + (++seq % 50) }) }],
  },
  {
    row: "Люди и роли",
    expect: [true, false, false, false],
    steps: (a) => {
      let slug = "";
      const mk = async () => (slug = (await admin.createPerson(await asOwner(), { fullName: `Матрица Проверка${++seq}`, role: "LEADER", zone: "Проверка прав", direction: "osago" })).slug);
      return [
        { name: "добавить человека", act: () => admin.createPerson(a, { fullName: `Матрица Проверка${++seq}`, role: "LEADER", zone: "Проверка прав", direction: "osago" }) },
        { name: "сменить роль", setup: mk, act: () => admin.updatePerson(a, slug, { role: "ADMIN" }) },
        { name: "выключить", setup: mk, act: () => admin.setPersonActive(a, slug, false) },
      ];
    },
  },
  {
    row: "Пароли и синхронизация (разделы владельца)",
    expect: [true, false, false, false],
    steps: (a) => [{ name: "разделы владельца", act: async () => !canSeeOwnerSections(a.role === "OBSERVER" ? null : a.management) && fail("разделы владельца закрыты") }],
  },
  {
    row: "Журнал изменений: весь",
    expect: [true, true, false, false],
    steps: (a) => [{ name: "общий журнал", act: async () => !canSeeJournal(a.management, a.role) && fail("журнал закрыт для этой роли: только режим управления") }],
  },
  {
    row: "Журнал изменений: история своих задач",
    expect: [true, true, true, false],
    steps: (a, who) => [
      {
        name: "история своей",
        act: async () => {
          const t = (await tasks.getTask(ownTask(who)))!;
          if (!canSeeTaskHistory(t, { slug: a.slug, management: a.management, observer: a.role === "OBSERVER" })) fail("история видна участникам задачи");
          expect((await tasks.taskHistory(t.number)).length).toBeGreaterThan(0);
        },
      },
    ],
  },
  {
    row: "Журнал изменений: история чужих задач",
    expect: [true, true, false, false],
    steps: (a) => [
      {
        name: "история чужой",
        act: async () => {
          const t = (await tasks.getTask(fx.foreign))!;
          if (!canSeeTaskHistory(t, { slug: a.slug, management: a.management, observer: a.role === "OBSERVER" })) fail("история видна участникам задачи");
        },
      },
    ],
  },
];

function fail(message: string): never {
  throw new tasks.TaskRuleError(message);
}

const expected = (row: Row, who: Who): boolean => {
  const [owner, adm, leader, observer] = row.expect;
  return { owner, admin: adm, leader, observer, ownerPlain: leader, adminPlain: leader }[who];
};

describe("матрица прав раздела 2: каждая строка для каждой роли", () => {
  for (const row of MATRIX) {
    describe(row.row, () => {
      for (const who of WHO) {
        const want = expected(row, who);
        it(`${TITLE[who]}: ${want ? "да" : "нет"}`, async () => {
          const a = await actorOf(who);
          for (const step of row.steps(a, who)) {
            if (step.setup) await step.setup();
            expect(await allowed(step.act), `${step.name}: ожидалось ${want ? "разрешено" : "запрещено"}`).toBe(want);
          }
        });
      }
    });
  }
});

describe("охрана ролей", () => {
  it("последнего владельца нельзя выключить или понизить, себя выключить нельзя", async () => {
    const owner = await actorOf("owner");
    await expect(admin.setPersonActive(owner, "muradyan", false)).rejects.toThrow(/Себя выключить нельзя/);
    await expect(admin.updatePerson(owner, "muradyan", { role: "ADMIN" })).rejects.toThrow(/хотя бы один включённый владелец/);
  });

  it("выключенный человек не становится ответственным и пропадает из ленты недели", async () => {
    const owner = await actorOf("owner");
    const p = await admin.createPerson(owner, { fullName: "Матрица Выключаемый", role: "LEADER", zone: "Проверка", direction: "osago" });
    expect((await weekly.getWeekView(fx.rk)).reports.some((r) => r.author === p.slug)).toBe(true);
    await admin.setPersonActive(owner, p.slug, false);
    await expect(tasks.createTask(owner, newTask(p.slug))).rejects.toThrow(/нет в команде/);
    expect((await weekly.getWeekView(fx.rk)).reports.some((r) => r.author === p.slug)).toBe(false);
  });

  it("наблюдатель не становится ответственным", async () => {
    const owner = await actorOf("owner");
    const p = await admin.createPerson(owner, { fullName: "Матрица Наблюдатель", role: "OBSERVER", zone: "Чтение", direction: "department" });
    await expect(tasks.createTask(owner, newTask(p.slug))).rejects.toThrow(/нет в команде/);
  });
});
