// Этап 54, второй круг проверки кода: сценарии S1-S19 ревьюера проверками. Автор правила у задачи из просьбы и из
// Bord, отказ в передаче задачи без ответственного, «Отменена» в «Выполнена», цепочка передач, выключенный новый
// ответственный, согласованные задачи при смене структуры, события руководителю соисполнителя, кеш правила, объём.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as req from "@/lib/requests/service";
import { setPersonActive } from "@/lib/admin/service";
import { listInbox } from "@/lib/inbox/service";
import { eventPhrase, pathOf } from "@/lib/letters/phrases";
import { TOP_TEAM } from "@/lib/org/scope";
import { APPROVAL_KEY, approvalDepartments, approvalRule, forgetApprovalCtx, refreshApprovals } from "@/lib/tasks/approval";
import { saveApprovalSetting } from "@/lib/tasks/approval-settings";
import { moscowToday, dbDate } from "@/lib/tasks/dates";
import { addDays } from "@/domain/dates";

const future = addDays(moscowToday(), 10);
const owner = () => svc.actorFor("muradyan", "OWNER");
const INS = "Департамент страхования и инвестиций";
const FIN = "Финансовый департамент";
const rows = (pogosovaUnit = "Управление финансового учёта и контроля") =>
  [
    ["ФИО", "Должность", "Департамент", "Управление", "Руководитель", "Руководит"],
    ["Крайник Александр", "CEO", "", "", "", "да"],
    ["Мурадян Арам", "Директор департамента", INS, "", "", "да"],
    ["Рева Тарас Игоревич", "CPO", INS, "Управление продуктового развития (insurance)", "", "да"],
    ["Токов Никита Андреевич", "Analytics Lead", INS, "Управление продуктового развития (insurance)", "", ""],
    ["Харченко Артём", "CFO", FIN, "", "", "да"],
    ["Кацемба Наталья Сергеевна", "Chief Accountant", FIN, "Управление финансового учёта и контроля", "", "да"],
    ["Погосова Сабина Левоновна", "Finance coordinator", FIN, pogosovaUnit, "", ""],
    ["Комаричев Сергей Владимирович", "Head of Data", FIN, "Управление хранения данных", "", "да"],
    ["Белов Иван Петрович", "Data engineer", FIN, "Управление хранения данных", "", ""],
    ["Орлова Мария", "Analyst", FIN, "Управление хранения данных", "", ""],
  ]
    .map((r) => r.join(";"))
    .join("\n");

const person = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
const actorOf = async (start: string, via: "PASSWORD" | "TEAM" = "PASSWORD") => ({ ...(await svc.actorFor((await person(start)).slug)), via });
const teamLedBy = (start: string) => prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: start } }, kind: "UNIT" } });
const newTask = async (a: svc.Actor, ownerSlug: string, team: string, title: string, extra: Partial<svc.NewTaskInput> = {}) =>
  (await svc.createTask(a, { title, outcome: "Готово", owner: ownerSlug, direction: "department", due: future, team, ...extra })).task;
const row = (number: number) =>
  prisma.task.findUniqueOrThrow({ where: { number }, select: { id: true, status: true, approvalState: true, approverId: true, approvalFromId: true, approvalFromStatus: true, ownerId: true, ownerAll: true, repeat: true, coExecutors: { select: { personId: true } } } });
const openApprovals = async (start: string, number: number) => prisma.inboxEvent.count({ where: { kind: "APPROVAL", doneAt: null, task: { number }, recipient: { fullName: { startsWith: start } } } });
// Участники из другой ветки в команде Ревы как свои: так руководитель команды может сменить им ответственного (синтетика)
const withInternal = async <T>(fn: () => Promise<T>): Promise<T> => {
  await prisma.teamMember.updateMany({ where: { teamId: revaTeam }, data: { external: false } });
  try {
    return await fn();
  } finally {
    await prisma.teamMember.updateMany({ where: { teamId: revaTeam, person: { fullName: { startsWith: "Погосова" } } }, data: { external: true } });
    await prisma.teamMember.updateMany({ where: { teamId: revaTeam, person: { fullName: { startsWith: "Белов" } } }, data: { external: true } });
  }
};
// Подробности сценария при отладке: npx vitest run ... с DEBUG_APPROVAL=1
const show = (label: string, v: unknown) => {
  if (process.env.DEBUG_APPROVAL) console.log(`[approval] ${label}: ${JSON.stringify(v)}`);
};
// Пересчёт без настоящей смены структуры: включить и выключить человека, к задачам отношения не имеющего
const touchStructure = async () => {
  const orl = await person("Орлова");
  await setPersonActive(await owner(), orl.slug, false);
  await setPersonActive(await owner(), orl.slug, true);
};

async function clean() {
  await prisma.task.deleteMany();
  await prisma.helpRequest.deleteMany();
  await prisma.teamJoinRequest.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: TOP_TEAM } } });
  await prisma.goal.deleteMany();
  await prisma.team.deleteMany({ where: { id: { not: TOP_TEAM } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.inboxEvent.deleteMany();
  await prisma.weeklyEntry.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  for (let i = 0; i < 10 && (await prisma.orgUnit.count()); i++) await prisma.orgUnit.deleteMany({ where: { children: { none: {} } } });
  await prisma.setting.deleteMany({ where: { key: APPROVAL_KEY } });
}

let reva: svc.Actor;
let revaTeam: string;
let finId: string;
let directionId: string;

beforeAll(async () => {
  await clean();
  await org.applyStructure(await owner(), rows());
  revaTeam = (await teamLedBy("Рева")).id;
  for (const p of ["Погосова", "Белов", "Токов"]) {
    const slug = (await person(p)).slug;
    if (!(await prisma.teamMember.findFirst({ where: { teamId: revaTeam, person: { slug } } }))) await org.addTeamMember(await owner(), revaTeam, slug);
  }
  finId = (await approvalDepartments()).find((d) => d.name === FIN)!.id;
  await saveApprovalSetting(await owner(), { default: "inform", departments: { [finId]: "approve" } });
  reva = await actorOf("Рева");
  directionId = (await prisma.dictionaryItem.findFirstOrThrow({ where: { kind: "DIRECTION", code: "department" } })).id;
});
afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

describe("корень: автор просьбы не хранится", () => {
  it("S1: пересчёт структуры снимает согласование с задачи из просьбы", async () => {
    const pog = await actorOf("Погосова");
    const r = await req.createRequest(reva, { to: pog.slug, text: "S1 комиссии партнёров", due: future });
    const done = await req.requestToTask(pog, r.number, "department");
    const before = await row(done.task);
    show("S1 до пересчёта", { status: before.status, state: before.approvalState });
    await touchStructure();
    const after = await row(done.task);
    show("S1 после пересчёта", { status: after.status, state: after.approvalState, approver: after.approverId });
    expect(after.approvalState).toBe("PENDING");
    // Погосова принимает задачу сама
    const self = await svc.changeStatus(pog, done.task, "in-progress").then((x) => x.task.status, (e: Error) => `ошибка: ${e.message}`);
    show("S1 Погосова принимает сама", self);
    expect(self).toMatch(/ошибка/);
  });

  it("S2: отклонённую задачу из просьбы ответственная открывает без согласования", async () => {
    const pog = await actorOf("Погосова");
    const r = await req.createRequest(reva, { to: pog.slug, text: "S2 сверка с банком", due: future });
    const done = await req.requestToTask(pog, r.number, "department");
    await svc.changeStatus(await actorOf("Кацемба"), done.task, "cancelled", "Нет времени");
    const again = await svc.changeStatus(pog, done.task, "in-progress");
    show("S2 после открытия", { status: again.task.status, approval: again.task.approval });
    expect(again.task.status).toBe("proposed");
    expect(again.task.approval?.state).toBe("pending");
  });

  it("S3: согласованную задачу из просьбы передают внутри финансов без согласования", async () => {
    const pog = await actorOf("Погосова");
    const r = await req.createRequest(reva, { to: pog.slug, text: "S3 выгрузка проводок", due: future });
    const done = await req.requestToTask(pog, r.number, "department");
    await svc.changeStatus(await actorOf("Кацемба"), done.task, "in-progress");
    const t = await row(done.task);
    const team = (await prisma.task.findUniqueOrThrow({ where: { id: t.id }, select: { teamId: true } })).teamId;
    show("S3 команда задачи", { team, revaTeam });
    const h = await svc.handOver(pog, done.task, (await person("Белов")).slug as never, "Иван доделает").then((x) => x.task, (e: Error) => `ошибка: ${e.message}`);
    show("S3 передача Белову", typeof h === "string" ? h : { status: h.status, approval: h.approval });
    if (typeof h !== "string") expect(h.approval?.state).toBe("pending");
  });

  it("S4: задача из Bord (без автора), о которой руководитель проинформирован, теряет отметку при любом пересчёте", async () => {
    const tok = await person("Токов");
    const number = 4001;
    await prisma.task.create({ data: { number, title: "S4 из Bord", outcome: "Готово", ownerId: tok.id, directionId, status: "IN_PROGRESS", whereUpdatedAt: dbDate(moscowToday()), due: dbDate(future), teamId: revaTeam, createdById: null } });
    const a = await svc.assignOwner(await owner(), number, (await person("Погосова")).slug as never);
    show("S4 после смены ответственного режимом управления", a.task.approval);
    await touchStructure();
    const after = await row(number);
    show("S4 после пересчёта", { state: after.approvalState, approver: after.approverId });
    expect(after.approvalState).toBe("INFORMED");
  });
});

describe("отказ и открытие", () => {
  it("S5: отклонённую задачу ответственная закрывает «Выполнена» из «Отменена» без согласования", async () => {
    const pog = await actorOf("Погосова");
    const t = await newTask(reva, pog.slug, revaTeam, "S5 отклонят");
    await svc.changeStatus(await actorOf("Кацемба"), t.number, "cancelled", "Нет времени");
    const done = await svc.changeStatus(pog, t.number, "done", "Сделала всё равно").then((x) => x.task, (e: Error) => `ошибка: ${e.message}`);
    show("S5 Отменена -> Выполнена", typeof done === "string" ? done : { status: done.status, approval: done.approval });
    expect(typeof done === "string" ? done : done.status).toMatch(/ошибка/);
  });

  it("S6: отказ в передаче задачи без ответственного отменяет задачу и серию", async () => {
    const number = 4006;
    await prisma.task.create({ data: { number, title: "S6 без ответственного", outcome: "Готово", ownerId: null, directionId, status: "IN_PROGRESS", whereUpdatedAt: dbDate(moscowToday()), due: dbDate(future), teamId: revaTeam, createdById: null, repeat: "WEEKLY" } });
    const a = await svc.handOver(reva, number, (await person("Погосова")).slug as never, "Сабина возьмёт");
    show("S6 после назначения", { status: a.task.status, approval: a.task.approval });
    const r = await svc.changeStatus(await actorOf("Кацемба"), number, "cancelled", "Не наше");
    const after = await row(number);
    show("S6 после отказа", { status: after.status, state: after.approvalState, owner: after.ownerId, repeat: after.repeat, fromStatus: after.approvalFromStatus });
    expect(r.task.status).not.toBe("cancelled");
    expect(after.repeat).toBe("WEEKLY");
  });

  it("S7: цепочка передач: прежний ответственный сохраняется, отказ второго согласующего возвращает задачу", async () => {
    const tok = await actorOf("Токов");
    const t = await newTask(reva, tok.slug, revaTeam, "S7 цепочка");
    await svc.handOver(tok, t.number, (await person("Погосова")).slug as never, "Сабина");
    const a = await withInternal(async () => svc.assignOwner(reva, t.number, (await person("Белов")).slug as never));
    show("S7 после второй передачи", { status: a.task.status, approval: a.task.approval });
    expect(a.task.approval).toMatchObject({ state: "pending", approver: (await person("Комаричев")).slug, from: tok.slug });
    expect(await openApprovals("Кацемба", t.number)).toBe(0);
    const r = await svc.changeStatus(await actorOf("Комаричев"), t.number, "cancelled", "Иван занят");
    show("S7 после отказа", { status: r.task.status, owner: r.task.owner, co: r.task.coExecutors });
    expect(r.task.owner).toBe(tok.slug);
    expect(r.task.status).toBe("in-progress");
  });

  it("S8: передачу вернули прежнему ответственному сменой ответственного: статус «Предложена» остаётся", async () => {
    const tok = await actorOf("Токов");
    const t = await newTask(reva, tok.slug, revaTeam, "S8 вернули");
    await svc.handOver(tok, t.number, (await person("Погосова")).slug as never, "Сабина");
    const back = await svc.assignOwner(reva, t.number, tok.slug as never);
    const after = await row(t.number);
    show("S8 после возврата Токову", { status: back.task.status, approval: back.task.approval, fromId: after.approvalFromId });
    expect(back.task.status).toBe("in-progress");
    expect(await openApprovals("Кацемба", t.number)).toBe(0);
  });

  it("S9: передачу ждут, нового ответственного выключили: отметка о прежнем ответственном теряется", async () => {
    const tok = await actorOf("Токов");
    const t = await newTask(reva, tok.slug, revaTeam, "S9 выключили");
    await svc.handOver(tok, t.number, (await person("Белов")).slug as never, "Иван");
    await setPersonActive(await owner(), (await person("Белов")).slug, false);
    const after = await row(t.number);
    show("S9 после выключения Белова", { status: after.status, state: after.approvalState, fromId: after.approvalFromId, owner: after.ownerId === (await person("Белов")).id ? "Белов" : after.ownerId });
    // Передача отменена: задача снова у Токова в работе, отметок согласования нет
    expect(after.ownerId).toBe((await person("Токов")).id);
    expect(after.status).toBe("IN_PROGRESS");
    expect(after.approvalState).toBeNull();
    await setPersonActive(await owner(), (await person("Белов")).slug, true);
  });

  it("S10: согласованная задача после переезда сотрудника остаётся у прежнего согласующего", async () => {
    const pog = await actorOf("Погосова");
    const t = await newTask(reva, pog.slug, revaTeam, "S10 согласована");
    await svc.changeStatus(await actorOf("Кацемба"), t.number, "in-progress");
    await org.setPersonOrg(await owner(), pog.slug, { manager: (await person("Комаричев")).slug });
    const after = await row(t.number);
    const kats = await person("Кацемба");
    const seen = await svc.getTask(t.number, { personId: kats.id, role: kats.role });
    show("S10 после смены руководителя", { approver: after.approverId === kats.id ? "Кацемба" : after.approverId, katsembaSees: !!seen });
    expect(after.approverId).toBe((await person("Комаричев")).id);
    await org.setPersonOrg(await owner(), pog.slug, { manager: kats.slug });
  });
});

describe("соисполнители и события без задачи", () => {
  it("S11: событие руководителю соисполнителя: «Мне», письмо и отмена создания", async () => {
    await saveApprovalSetting(await owner(), { default: "inform", departments: {} });
    const tok = await person("Токов");
    const pog = await person("Погосова");
    const created = await svc.createTask(reva, { title: "S11 соисполнитель", outcome: "Готово", owner: tok.slug, coExecutors: [pog.slug] as never, direction: "department", due: future, team: revaTeam });
    const kats = await person("Кацемба");
    const inbox = await listInbox(kats.id);
    const item = inbox.items.find((i) => i.subject.startsWith("approval-co:"));
    show("S11 «Мне»", item && { taskNumber: item.taskNumber, text: item.text, kind: item.kind });
    const event = await prisma.inboxEvent.findFirstOrThrow({ where: { subject: { startsWith: "approval-co:" }, recipientId: kats.id } });
    const line = { kind: event.kind, actorName: event.actorName, taskNumber: null, entryId: null, commentId: null, subject: event.subject };
    show("S11 письмо", { phrase: eventPhrase(line), path: pathOf(line) });
    // Кацемба может открыть задачу?
    const sees = await svc.getTask(created.task.number, { personId: kats.id, role: kats.role });
    show("S11 Кацемба видит задачу", !!sees);
    // Отмена создания: задачи нет, событие остаётся
    await svc.undoChange(reva, created.undo!);
    const left = await prisma.inboxEvent.count({ where: { id: event.id, doneAt: null } });
    show("S11 событие после отмены создания", left);
    expect(left).toBe(0);
    await saveApprovalSetting(await owner(), { default: "inform", departments: { [finId]: "approve" } });
  });

  it("S12: соисполнитель из того же департамента, что ответственный по просьбе: createTaskIn и setCoExecutors расходятся", async () => {
    const pog = await actorOf("Погосова");
    const r = await req.createRequest(reva, { to: pog.slug, text: "S12 отчёт", due: future });
    const done = await req.requestToTask(pog, r.number, "department");
    await svc.changeStatus(await actorOf("Кацемба"), done.task, "in-progress");
    const res = await svc.setCoExecutors(pog, done.task, [(await person("Белов")).slug] as never).then(() => "добавлен", (e: Error) => `ошибка: ${e.message}`);
    show("S12 Погосова добавляет Белова соисполнителем", res);
    expect(res).toMatch(/ошибка: Соисполнитель Белов/);
  });
});

describe("кеш контекста правила", () => {
  it("S13: клиент транзакции разный у разных транзакций", async () => {
    let a: object | null = null;
    let b: object | null = null;
    await prisma.$transaction(async (tx) => {
      a = tx;
    });
    await prisma.$transaction(async (tx) => {
      b = tx;
    });
    show("S13 один и тот же объект", a === b);
    expect(a).not.toBe(b);
  });

  it("S14: внутри транзакции после сброса кеша правило видит смену структуры", async () => {
    const pog = await person("Погосова");
    const insUnit = (await person("Токов")).unitId!;
    const sentinel = new Error("rollback");
    let r1: unknown = null;
    let r2: unknown = null;
    let fresh: unknown = null;
    await prisma
      .$transaction(async (tx) => {
        r1 = await approvalRule(tx, reva.personId, pog.id);
        await tx.person.update({ where: { id: pog.id }, data: { unitId: insUnit, managerId: reva.personId } });
        // Кто меняет структуру в той же транзакции, сбрасывает кеш правила
        forgetApprovalCtx(tx);
        r2 = await approvalRule(tx, reva.personId, pog.id);
        throw sentinel;
      })
      .catch((e) => {
        if (e !== sentinel) throw e;
      });
    await prisma
      .$transaction(async (tx) => {
        await tx.person.update({ where: { id: pog.id }, data: { unitId: insUnit, managerId: reva.personId } });
        fresh = await approvalRule(tx, reva.personId, pog.id);
        throw sentinel;
      })
      .catch((e) => {
        if (e !== sentinel) throw e;
      });
    show("S14", { r1, r2, fresh });
    expect(fresh).toBeNull();
    expect(r2).toBeNull();
  });
});

describe("производительность пересчёта", () => {
  it("S15: 500 людей, 360 задач с информированием: пересчёт без изменений и при выключении руководителя", async () => {
    const fin = (await prisma.orgUnit.findFirstOrThrow({ where: { name: FIN } })).id;
    const unit = await prisma.orgUnit.create({ data: { name: "Perf управление", kind: "MANAGEMENT", parentId: fin } });
    const head = await prisma.person.create({ data: { slug: "perf-head", fullName: "Перф Руководитель", shortName: "Перф", role: "EMPLOYEE", zone: "perf", unitId: unit.id, active: true } });
    await prisma.orgUnit.update({ where: { id: unit.id }, data: { headId: head.id } });
    const people = Array.from({ length: 490 }, (_, i) => ({ slug: `perf-${i}`, fullName: `Перф Сотрудник ${i}`, shortName: `П${i}`, role: "EMPLOYEE" as const, zone: "perf", unitId: unit.id, managerId: head.id, active: true }));
    await prisma.person.createMany({ data: people });
    const subs = await prisma.person.findMany({ where: { slug: { startsWith: "perf-" }, managerId: head.id }, select: { id: true }, take: Number(process.env.PERF_SUBS ?? 60) });
    let n = 5000;
    const tasks = subs.flatMap((s) => Array.from({ length: 6 }, () => ({ number: n++, title: "perf", outcome: "perf", ownerId: s.id, directionId, status: "IN_PROGRESS" as const, whereUpdatedAt: dbDate(moscowToday()), due: dbDate(future), teamId: revaTeam, createdById: reva.personId, approvalState: "INFORMED" as const, approverId: head.id })));
    await prisma.task.createMany({ data: tasks });
    show("S15 людей всего", await prisma.person.count());
    const ow = await owner();
    let t0 = performance.now();
    await prisma.$transaction((tx) => refreshApprovals(tx, ow));
    const noop = performance.now() - t0;
    t0 = performance.now();
    const res = await setPersonActive(ow, "perf-head", false).then(() => "ok", (e: Error) => `ошибка: ${e.message.slice(-300)}`);
    const mass = performance.now() - t0;
    const moved = await prisma.task.count({ where: { number: { gte: 5000 }, approverId: { not: head.id } } });
    show("S15 время", { noopMs: Math.round(noop), massMs: Math.round(mass), res, moved, total: tasks.length });
    // Сколько запросов на одну поменявшуюся задачу: оценка по времени
    show("S15 мс на задачу", Math.round((mass / Math.max(moved, 1)) * 10) / 10);
    expect(res).toBe("ok");
    expect(moved).toBe(tasks.length);
    await prisma.task.deleteMany({ where: { number: { gte: 5000 } } });
    await prisma.inboxEvent.deleteMany({ where: { recipient: { slug: { startsWith: "perf" } } } });
  }, 300_000);
});

describe("тексты и прочее", () => {
  it("S16: отказ в передаче: кто узнаёт, текст событий", async () => {
    const tok = await actorOf("Токов");
    const t = await newTask(reva, tok.slug, revaTeam, "S16 тексты");
    await svc.handOver(tok, t.number, (await person("Погосова")).slug as never, "Сабина");
    await svc.changeStatus(await owner(), t.number, "cancelled", "Режим управления против");
    const events = await prisma.inboxEvent.findMany({ where: { task: { number: t.number } }, select: { kind: true, text: true, recipient: { select: { fullName: true } } }, orderBy: { createdAt: "asc" } });
    show(
      "S16 события",
      events.map((e) => `${e.recipient.fullName.split(" ")[0]} ${e.kind}: ${e.text}`),
    );
    expect(events.some((e) => e.recipient.fullName.startsWith("Токов") && e.kind === "TASK_ASSIGNED" && /Режим управления не согласовал передачу/.test(e.text))).toBe(true);
    expect(events.some((e) => e.recipient.fullName.startsWith("Рева") && e.kind === "TASK_CONFIRMED" && /вернулась прежнему ответственному/.test(e.text))).toBe(true);
    const hist = await svc.taskHistory(t.number);
    show(
      "S16 история",
      hist.map((h) => `${h.field}: ${h.before ?? ""} | ${h.after ?? ""}`),
    );
  });

  it("S17: режим управления открывает отклонённую: текст строки", async () => {
    const pog = await actorOf("Погосова");
    const t = await newTask(reva, pog.slug, revaTeam, "S17 открывает управление");
    await svc.changeStatus(await actorOf("Кацемба"), t.number, "cancelled", "Нет");
    await svc.changeStatus(await owner(), t.number, "in-progress");
    const hist = await svc.taskHistory(t.number);
    show("S17 строка", hist.find((h) => h.field === "Согласование")?.after);
    expect(hist.find((h) => h.field === "Согласование")?.after).toBe("Согласована: задачу открыл режим управления");
  });

  it("S18: Bord-подобный случай: задача на согласовании, руководитель команды меняет ответственного на того же согласующего", async () => {
    const pog = await actorOf("Погосова");
    const t = await newTask(reva, pog.slug, revaTeam, "S18 тот же согласующий");
    await saveApprovalSetting(await owner(), { default: "inform", departments: { [finId]: "approve" } });
    // Белов к Кацембе в подчинение временно
    const kats = await person("Кацемба");
    await org.setPersonOrg(await owner(), (await person("Белов")).slug, { manager: kats.slug });
    await withInternal(async () => svc.assignOwner(reva, t.number, (await person("Белов")).slug as never));
    show("S18 открытых событий у Кацембы", await openApprovals("Кацемба", t.number));
    expect(await openApprovals("Кацемба", t.number)).toBe(1);
    await org.setPersonOrg(await owner(), (await person("Белов")).slug, { manager: (await person("Комаричев")).slug });
  });

  it("S19: повторное открытие и просьба: просьба снова «принята», пока задача ждёт согласования", async () => {
    const pog = await actorOf("Погосова");
    const r = await req.createRequest(reva, { to: pog.slug, text: "S19 просьба", due: future });
    const done = await req.requestToTask(pog, r.number, "department");
    await svc.changeStatus(await actorOf("Кацемба"), done.task, "cancelled", "Нет");
    // Руководитель команды открывает задачу снова: она снова ждёт согласования
    const taskTeam = (await prisma.task.findUniqueOrThrow({ where: { number: done.task }, select: { teamId: true } })).teamId;
    const opener = taskTeam === revaTeam ? reva : pog;
    const again = await svc.changeStatus(opener, done.task, "in-progress");
    const hr = await prisma.helpRequest.findUniqueOrThrow({ where: { number: r.number }, select: { status: true } });
    show("S19", { task: again.task.status, approval: again.task.approval?.state, request: hr.status });
    expect(again.task.approval?.state).toBe("pending");
  });
});
