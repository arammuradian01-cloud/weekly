// Этап 61: разбор встречи из Notion. Кто запускает разбор, кто правит, кто отправляет CEO и создаёт задачи (общий логин
// не отправляет и не создаёт), разбор правилами и через Claude (подменённый транспорт), понятная ошибка Notion,
// задачи разом одной транзакцией без дублей, согласование этапа 54 для задачи человеку другого департамента, событие CEO
// в «Мне», отчёт CEO за неделю не затирается молча, забор Bord выключен по умолчанию. Настоящие Notion и Claude не вызываются.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import * as svc from "@/lib/tasks/service";
import * as org from "@/lib/org/service";
import * as weekly from "@/lib/weekly/service";
import * as parse from "@/lib/meeting/parse-service";
import * as bord from "@/lib/bord/service";
import { fakeNotionFetch } from "@/lib/meeting/notion-fake";
import { APPROVAL_KEY, approvalDepartments } from "@/lib/tasks/approval";
import { saveApprovalSetting } from "@/lib/tasks/approval-settings";
import { listInbox } from "@/lib/inbox/service";
import { bordPullOn, pullIfDue } from "@/lib/sheet/runner";
import { pullState } from "@/lib/bord/pull";
import { PROD_SHEET_ID } from "@/lib/sheet/client";
import type { ClaudeDeps } from "@/lib/meeting/claude";
import type { WeekKey } from "@/domain/types";

const INS = "Департамент страхования и инвестиций";
const FIN = "Финансовый департамент";
const COMPANY = [
  ["ФИО", "Должность", "Департамент", "Управление", "Руководитель", "Руководит"],
  ["Крайник Александр", "CEO", "", "", "", "да"],
  ["Мурадян Арам", "Директор департамента", INS, "", "", "да"],
  ["Рева Тарас Игоревич", "CPO", INS, "Управление продуктового развития (insurance)", "", "да"],
  ["Токов Никита Андреевич", "Analytics Lead", INS, "Управление продуктового развития (insurance)", "", ""],
  ["Харченко Артём", "CFO", FIN, "", "", "да"],
  ["Кацемба Наталья Сергеевна", "Chief Accountant", FIN, "Управление финансового учёта и контроля", "", "да"],
  ["Погосова Сабина Левоновна", "Finance coordinator", FIN, "Управление финансового учёта и контроля", "", ""],
]
  .map((r) => r.join(";"))
  .join("\n");

const RULES_PAGE = "https://www.notion.so/sravni/Vstrecha-upravleniya-5c6d7e8f901243a4b5c6d7e8f9a0b1c2";
const MISSING_PAGE = "https://www.notion.so/sravni/Ne-rasshareno-9f9f9f9f9f9f49f9a9f9f9f9f9f9f9f9";
const notion = { fetch: fakeNotionFetch("tests/fixtures/notion"), token: "fake", base: "https://notion.fake" };

const person = (start: string) => prisma.person.findFirstOrThrow({ where: { fullName: { startsWith: start } } });
/** Личный вход: так сервис отличает настоящего автора от общего логина */
const actorOf = async (start: string, management: svc.Actor["management"] = null): Promise<svc.Actor> => ({ ...(await svc.actorFor((await person(start)).slug, management)), via: "PASSWORD" });
const teamLogin = async (start: string, management: svc.Actor["management"] = null): Promise<svc.Actor> => ({ ...(await svc.actorFor((await person(start)).slug, management)), via: "TEAM" });
const owner = () => actorOf("Мурадян", "OWNER");
const expectRule = async (p: Promise<unknown>, message: RegExp) => {
  await expect(p).rejects.toBeInstanceOf(svc.TaskRuleError);
  await expect(p).rejects.toThrow(message);
};

/** Имитация Claude: тело Messages API с вызовом инструмента */
function fakeClaude(input: unknown, status = 200): ClaudeDeps & { calls: number } {
  const deps = {
    calls: 0,
    apiKey: "test-key",
    model: "claude-sonnet-5-5",
    base: "https://claude.fake",
    fetch: (async () => {
      deps.calls++;
      return new Response(JSON.stringify(status === 200 ? { stop_reason: "tool_use", content: [{ type: "tool_use", name: "meeting_result", input }] } : { error: { type: "overloaded_error" } }), { status });
    }) as unknown as typeof fetch,
  };
  return deps;
}

let key: WeekKey;
let revaTeam: string;

async function clean() {
  await prisma.meetingParse.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.task.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.inboxEvent.deleteMany();
  await prisma.teamJoinRequest.deleteMany();
  await prisma.teamMember.deleteMany({ where: { teamId: { not: "top" } } });
  await prisma.goal.deleteMany();
  await prisma.team.deleteMany({ where: { id: { not: "top" } } });
  await prisma.person.updateMany({ data: { unitId: null, managerId: null, functionalManagerId: null, position: null } });
  await prisma.weeklyEntry.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.weeklyReport.deleteMany({ where: { author: { role: "EMPLOYEE" } } });
  await prisma.person.deleteMany({ where: { role: "EMPLOYEE" } });
  await prisma.vacancy.deleteMany();
  for (let i = 0; i < 10 && (await prisma.orgUnit.count()); i++) await prisma.orgUnit.deleteMany({ where: { children: { none: {} } } });
  await prisma.setting.deleteMany({ where: { key: { in: [APPROVAL_KEY, "bord.sourceId", "bord.pullOn", "bord.pull", "bord.snapshot"] } } });
}

beforeAll(async () => {
  await clean();
  process.env.APP_URL = "http://localhost:3100";
  await org.applyStructure(await owner(), COMPANY);
  revaTeam = (await prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: "Рева" } }, kind: "UNIT" } })).id;
  // Погосова из финансов в команде Ревы; финансовый департамент согласует задачи своим людям
  await org.addTeamMember(await owner(), revaTeam, (await person("Погосова")).slug);
  const fin = (await approvalDepartments()).find((d) => d.name === FIN)!;
  await saveApprovalSetting(await owner(), { default: "inform", departments: { [fin.id]: "approve" } });
  key = await weekly.currentReportingKey();
});

beforeEach(async () => {
  await prisma.meetingParse.deleteMany();
  await prisma.decision.deleteMany();
  await prisma.meeting.deleteMany();
  await prisma.task.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.inboxEvent.deleteMany();
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

/** Разбор правилами встречи команды Ревы: запуск Ревой при личном входе и разбор с имитацией Notion без Claude */
async function readyParse(by?: svc.Actor, team = revaTeam, url = RULES_PAGE) {
  const { id } = await parse.startParse(by ?? (await actorOf("Рева")), team, key, url);
  await parse.runParse(id, { notion, claude: null });
  return id;
}

describe("кто запускает и видит разбор", () => {
  it("запускает ведущий: руководитель команды при личном входе или режим управления; участник и общий логин без управления нет", async () => {
    // Общий логин без режима управления видит только топ-команду и встречи не ведёт даже у руководителя
    await expectRule(parse.startParse(await teamLogin("Рева"), revaTeam, key, RULES_PAGE), /не видите/);
    await expectRule(parse.startParse(await teamLogin("Мурадян"), "top", key, RULES_PAGE), /ведёт встречу руководитель команды, руководитель выше или режим управления, при личном входе/);
    await expectRule(parse.startParse(await actorOf("Токов"), revaTeam, key, RULES_PAGE), /ведёт встречу/);
    await expectRule(parse.startParse(await actorOf("Рева"), revaTeam, key, "https://example.com/page"), /не похожа на страницу Notion/);
    const first = await parse.startParse(await actorOf("Рева"), revaTeam, key, RULES_PAGE);
    expect(first.started).toBe(true);
    // Двойное нажатие: второй разбор той же страницы не запускается
    expect(await parse.startParse(await actorOf("Рева"), revaTeam, key, RULES_PAGE)).toEqual({ id: first.id, started: false });
    // Встречи не было: разбор собрал повестку и запомнил ссылку
    const meeting = await prisma.meeting.findFirstOrThrow({ where: { teamId: revaTeam } });
    expect(meeting.notionUrl).toBe(RULES_PAGE);
    const view = await parse.getParse(await actorOf("Рева"), first.id);
    expect(view.status).toBe("pending");
    expect(await prisma.auditLog.count({ where: { action: "meeting.parse.start", entityId: meeting.id } })).toBe(1);
  });

  it("видят участники команды встречи, правят только ведущие; человек из другой ветки не видит", async () => {
    const id = await readyParse();
    const tokov = await parse.getParse(await actorOf("Токов"), id);
    expect(tokov).toMatchObject({ status: "ready", canEdit: false, canCreateTasks: false, canSendCeo: false });
    await expectRule(parse.saveParseDraft(await actorOf("Токов"), id, { ceo: { main: "- Своё", risks: "", next: "" } }), /ведёт встречу/);
    await expectRule(parse.createParseTasks(await actorOf("Токов"), id), /ведёт встречу/);
    await expectRule(parse.getParse(await actorOf("Кацемба"), id), /не видите/);
    const reva = await parse.getParse(await actorOf("Рева"), id);
    expect(reva).toMatchObject({ canEdit: true, canCreateTasks: true, canSendCeo: false });
    expect(reva.sendHint).toMatch(/владелец или администратор/);
  });
});

describe("разбор", () => {
  it("правилами без ключа Claude: итоги, решения, риски, черновик weekly для CEO, задачи с людьми компании; нераспознанный требует выбора", async () => {
    const id = await readyParse();
    const view = await parse.getParse(await actorOf("Рева"), id);
    expect(view).toMatchObject({ status: "ready", method: "rules", title: "Встреча управления продукта 20.10" });
    expect(view.note).toMatch(/ANTHROPIC_API_KEY/);
    expect(view.result.summary).toEqual(["Конверсия в покупку ОСАГО выросла до 12%"]);
    expect(view.result.decisions.map((d) => d.text)).toEqual(["запускаем тест новой формы расчёта в ноябре"]);
    expect(view.result.risks).toEqual(["Задержка выгрузки от финансов"]);
    expect(view.result.ceo.main).toContain("- Конверсия в покупку ОСАГО выросла до 12%");
    const [tokov, pogosova, ivanov] = view.result.tasks;
    expect(tokov).toMatchObject({ title: "собрать дашборд конверсии по СК", owner: (await person("Токов")).slug, dueGuessed: true, on: true });
    expect(pogosova).toMatchObject({ title: "Сверка комиссий партнёров за октябрь", owner: (await person("Погосова")).slug });
    expect(ivanov).toMatchObject({ owner: null, ownerText: "Иванов" });
    expect(view.pageText).toContain("## Задачи");
    // В журнал не попадает текст встречи: только что и сколько разобрано
    const done = await prisma.auditLog.findFirstOrThrow({ where: { action: "meeting.parse.done" } });
    expect(String(done.after)).toMatch(/Разобрано правилами: главного 1, решений 1, задач 3/);
    expect(String(done.after)).not.toContain("дашборд");
  });

  it("через Claude: ответ инструмента проверен, имена из списка людей сопоставлены, сбой Claude уводит разбор в правила", async () => {
    const reva = await actorOf("Рева");
    const claude = fakeClaude({
      summary: ["Конверсия \u2014 12%"],
      decisions: [{ text: "Тест формы в ноябре", owner: "Рева Тарас Игоревич" }],
      risks: [],
      next: ["Итоги теста через месяц"],
      ceo: { main: "- ОСАГО: конверсия 12%", risks: "", next: "- Тест формы в ноябре" },
      tasks: [{ title: "Собрать дашборд", outcome: "Дашборд конверсии по СК", owner: "Токов Никита Андреевич", coExecutors: ["Погосова Сабина Левоновна"], due: "" }],
    });
    const { id } = await parse.startParse(reva, revaTeam, key, RULES_PAGE);
    await parse.runParse(id, { notion, claude });
    const view = await parse.getParse(reva, id);
    expect(claude.calls).toBe(1);
    expect(view).toMatchObject({ method: "ai", model: "claude-sonnet-5-5" });
    expect(view.result.summary).toEqual(["Конверсия - 12%"]);
    expect(view.result.ceo).toEqual({ main: "- ОСАГО: конверсия 12%", risks: "", next: "- Тест формы в ноябре" });
    expect(view.result.tasks[0]).toMatchObject({ owner: (await person("Токов")).slug, coExecutors: [(await person("Погосова")).slug] });
    expect(view.result.decisions[0]!.owner).toBe((await person("Рева")).slug);

    await prisma.meetingParse.deleteMany();
    const broken = fakeClaude(null, 529);
    const second = await parse.startParse(reva, revaTeam, key, RULES_PAGE);
    await parse.runParse(second.id, { notion, claude: broken });
    const fallback = await parse.getParse(reva, second.id);
    expect(fallback.method).toBe("rules");
    expect(fallback.note).toMatch(/Claude не разобрал встречу: Claude перегружен/);
    expect(fallback.result.tasks).toHaveLength(3);
  });

  it("страница не расшарена: понятная ошибка, повторить может ведущий", async () => {
    const reva = await actorOf("Рева");
    const { id } = await parse.startParse(reva, revaTeam, key, MISSING_PAGE);
    await parse.runParse(id, { notion, claude: null });
    const view = await parse.getParse(reva, id);
    expect(view.status).toBe("failed");
    expect(view.note).toMatch(/не расшарена на интеграцию/);
    expect(view.canRetry).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "meeting.parse.fail" } })).toBeGreaterThan(0);
    await expectRule(parse.retryParse(await actorOf("Токов"), id), /ведёт встречу/);
    await parse.retryParse(reva, id);
    expect((await parse.getParse(reva, id)).status).toBe("pending");
    // Нет ключа интеграции: тоже словами
    await parse.runParse(id, { notion: { ...notion, token: "" }, claude: null });
    expect((await parse.getParse(reva, id)).note).toMatch(/NOTION_TOKEN/);
  });
});

describe("задачи из разбора", () => {
  it("общий логин не создаёт; нераспознанный ответственный останавливает всё; потом разом, без дублей, с согласованием этапа 54", async () => {
    const id = await readyParse();
    const reva = await actorOf("Рева");
    await expectRule(parse.createParseTasks(await teamLogin("Рева", "OWNER"), id), /при личном входе/);
    await expectRule(parse.createParseTasks(reva, id), /Выберите ответственного в задаче «созвониться с СК по API»: в тексте встречи «Иванов»/);
    expect(await prisma.task.count()).toBe(0);

    const view = await parse.getParse(reva, id);
    const tokovSlug = (await person("Токов")).slug;
    // Ведущий выбрал ответственного вместо нераспознанного «Иванова»
    const tasksFixed = view.result.tasks.map((t) => (t.ownerText === "Иванов" ? { ...t, owner: tokovSlug } : t));
    // Двойное нажатие одновременно: задачи создаются один раз
    const [a, b] = await Promise.all([parse.createParseTasks(reva, id, { tasks: tasksFixed, decisions: true }), parse.createParseTasks(reva, id, { tasks: tasksFixed, decisions: true })]);
    expect(a.numbers).toHaveLength(3);
    expect(b.numbers).toEqual(a.numbers);
    expect([a.already, b.already].sort()).toEqual([false, true]);
    expect(await prisma.task.count()).toBe(3);
    const again = await parse.createParseTasks(reva, id, { tasks: tasksFixed });
    expect(again).toMatchObject({ already: true, numbers: a.numbers });
    expect(await prisma.task.count()).toBe(3);

    const rows = await prisma.task.findMany({ where: { number: { in: a.numbers } }, include: { owner: true, approver: true } });
    expect(rows.every((t) => t.sourceCode === "meeting" && t.teamId === revaTeam && t.createdById === reva.personId)).toBe(true);
    // Погосова из финансового департамента: задача ждёт согласования её руководителя
    const pogosova = rows.find((t) => t.owner?.fullName.startsWith("Погосова"))!;
    expect(pogosova).toMatchObject({ status: "PROPOSED", approvalState: "PENDING" });
    expect(pogosova.approver?.fullName).toMatch(/^Кацемба/);
    expect(await prisma.inboxEvent.count({ where: { kind: "APPROVAL", recipientId: (await person("Кацемба")).id } })).toBe(1);
    const tokov = rows.find((t) => t.title === "собрать дашборд конверсии по СК")!;
    expect(tokov).toMatchObject({ status: "IN_PROGRESS", approvalState: null });

    const after = await parse.getParse(reva, id);
    expect(after).toMatchObject({ statusLabel: "Задачи созданы", canCreateTasks: false, decisionsCreated: 1 });
    expect(after.createdTasks.find((t) => t.number === pogosova.number)).toMatchObject({ approval: "pending", proposed: true });
    expect(await prisma.decision.count({ where: { meetingId: after.meetingId } })).toBe(1);
    expect(await prisma.auditLog.findFirst({ where: { action: "meeting.parse.tasks" } })).toMatchObject({ after: expect.stringMatching(/Создано задач: 3/) });
    // После создания задач повторный разбор этой строки не запускается
    await expectRule(parse.retryParse(reva, id), /уже отправлен weekly или созданы задачи/);
  });

  it("снятые задачи не создаются, ошибка одной задачи откатывает все", async () => {
    const id = await readyParse();
    const reva = await actorOf("Рева");
    const view = await parse.getParse(reva, id);
    const pastDue = view.result.tasks.map((t, i) => ({ ...t, owner: t.owner ?? (null as string | null), on: i < 2, due: i === 1 ? "2020-01-01" : t.due }));
    await expectRule(parse.createParseTasks(reva, id, { tasks: pastDue }), /Задача «Сверка комиссий партнёров за октябрь»: Срок не может быть в прошлом/);
    expect(await prisma.task.count()).toBe(0);
    const ok = view.result.tasks.map((t, i) => ({ ...t, on: i === 0 }));
    const res = await parse.createParseTasks(reva, id, { tasks: ok });
    expect(res.numbers).toHaveLength(1);
  });
});

describe("weekly для CEO", () => {
  it("отправляет владелец или администратор в режиме управления при личном входе; CEO руководитель компании, событие в «Мне»", async () => {
    const id = await readyParse(await owner(), "top");
    const draft = { main: "- ОСАГО: конверсия 12%", risks: "- Задержка выгрузки", next: "- Тест формы в ноябре" };
    await expectRule(parse.sendParseToCeo(await actorOf("Рева"), id, { ceo: draft }), /ведёт встречу|владелец или администратор/);
    await expectRule(parse.sendParseToCeo(await teamLogin("Мурадян", "OWNER"), id, { ceo: draft }), /при личном входе/);
    await expectRule(parse.sendParseToCeo(await actorOf("Мурадян"), id, { ceo: draft }), /владелец или администратор в режиме управления/);
    await expectRule(parse.sendParseToCeo(await owner(), id, { ceo: { main: "", risks: "", next: "" } }), /пустой/);

    const view = await parse.sendParseToCeo(await owner(), id, { ceo: draft });
    expect(view.statusLabel).toBe("Отправлено CEO");
    const krainik = await person("Крайник");
    const report = await weekly.getCeoReport(key);
    expect(report.sections).toEqual(draft);
    expect(report.sent).toMatchObject({ by: "Мурадян Арам", to: ["Крайник Александр"] });
    const inbox = await listInbox(krainik.id);
    expect(inbox.items.find((i) => i.subject === `ceo-report:${key}`)).toMatchObject({ kind: "MEETING", text: expect.stringMatching(/отправил weekly для CEO/) });
    // CEO видит отчёт только для чтения, остальным он не открывается этой дорогой
    const seen = await parse.ceoSentReports(krainik.id, key);
    expect(seen?.current).toMatchObject({ sections: draft, sentBy: "Мурадян Арам" });
    expect(await parse.ceoSentReports((await person("Токов")).id)).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "meeting.parse.ceo" } })).toMatchObject({ after: expect.stringMatching(/Отправлен в приложении: Крайник Александр. Новый отчёт/) });
  });

  it("отчёт недели уже есть: без выбора и по устаревшему экрану не отправляется; дописать по разделам или заменить", async () => {
    const id = await readyParse(await owner(), "top");
    const saved = await weekly.saveCeoReport(await owner(), key, { main: "- Бюджет 2027 защищён", risks: "", next: "- Встреча с СК" }, [{ title: "Встреча с ВСК", text: "Договорились о планах." }]);
    const draft = { main: "- ОСАГО: конверсия 12%", risks: "- Задержка выгрузки", next: "- встреча с СК" };
    await expectRule(parse.sendParseToCeo(await owner(), id, { ceo: draft, expected: saved.updatedAt }), /выберите, дописать/);
    await expectRule(parse.sendParseToCeo(await owner(), id, { ceo: draft, mode: "merge", expected: "2020-01-01T00:00:00.000Z" }), /поменялся/);
    const view = await parse.getParse(await owner(), id);
    expect(view.ceo?.existing.updatedAt).toBe(saved.updatedAt);
    await parse.sendParseToCeo(await owner(), id, { ceo: draft, mode: "merge", expected: saved.updatedAt });
    const merged = await weekly.getCeoReport(key);
    expect(merged.sections).toEqual({ main: "- Бюджет 2027 защищён\n- ОСАГО: конверсия 12%", risks: "- Задержка выгрузки", next: "- Встреча с СК" });
    expect(merged.meetings).toEqual([{ title: "Встреча с ВСК", text: "Договорились о планах." }]);
    await parse.sendParseToCeo(await owner(), id, { ceo: draft, mode: "replace", expected: merged.updatedAt });
    expect((await weekly.getCeoReport(key)).sections).toEqual(draft);
  });

  it("нет руководителя компании: CEO из профиля ceo, если он включён; иначе понятная ошибка", async () => {
    const id = await readyParse(await owner(), "top");
    const company = await prisma.orgUnit.findFirstOrThrow({ where: { kind: "COMPANY" } });
    await prisma.orgUnit.update({ where: { id: company.id }, data: { headId: null } });
    try {
      await expectRule(parse.sendParseToCeo(await owner(), id, { ceo: { main: "- Главное", risks: "", next: "" } }), /Не найден CEO/);
      await prisma.person.update({ where: { slug: "ceo" }, data: { active: true } });
      expect((await parse.ceoRecipients()).map((p) => p.slug)).toEqual(["ceo"]);
      await parse.sendParseToCeo(await owner(), id, { ceo: { main: "- Главное", risks: "", next: "" } });
      const ceo = await prisma.person.findUniqueOrThrow({ where: { slug: "ceo" } });
      expect(await prisma.inboxEvent.count({ where: { recipientId: ceo.id, subject: `ceo-report:${key}` } })).toBe(1);
    } finally {
      await prisma.person.update({ where: { slug: "ceo" }, data: { active: false } });
      await prisma.orgUnit.update({ where: { id: company.id }, data: { headId: company.headId } });
    }
  });
});

describe("забор задач из Bord", () => {
  it("по умолчанию выключен: со ссылкой на Bord фоновый цикл ничего не забирает; включает только владелец", async () => {
    process.env.SHEET_FAKE = "1";
    try {
      expect(await bordPullOn()).toBe(false);
      await prisma.setting.create({ data: { key: "bord.sourceId", value: PROD_SHEET_ID } });
      await pullIfDue(new Date());
      expect((await pullState()).history).toHaveLength(0);
      expect(await bord.bordStatus()).toMatchObject({ connected: true, auto: false, nextAt: null });
      await expectRule(bord.setBordPull(await actorOf("Головкин", "ADMIN"), true), /только владелец/);
      await bord.setBordPull(await owner(), true);
      expect(await bordPullOn()).toBe(true);
      expect(await prisma.auditLog.findFirst({ where: { action: "sync.bord", field: "Забор задач из Bord по расписанию" }, orderBy: { id: "desc" } })).toMatchObject({ before: "выключен", after: "включён" });
      await bord.setBordPull(await owner(), false);
      expect(await bordPullOn()).toBe(false);
    } finally {
      delete process.env.SHEET_FAKE;
      await prisma.setting.deleteMany({ where: { key: { in: ["bord.sourceId", "bord.pullOn"] } } });
    }
  });
});
