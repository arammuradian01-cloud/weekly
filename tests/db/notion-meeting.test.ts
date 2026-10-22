// Этап 61: разбор встречи из Notion. Кто запускает разбор, кто правит, кто что видит (наблюдатель и общий логин без
// черновика weekly и текста страницы), кто отправляет CEO и создаёт задачи, разбор правилами и через Claude (подменённый
// транспорт), пустая и частично нечитаемая страница, разрешённые разделы Notion, отметка «жив», повторный разбор,
// задачи разом без дублей с согласованием этапа 54 и целью из черновика, решения по одному, событие о готовности,
// событие CEO в «Мне», собранный отчёт CEO со снимком и честной отметкой «поправили после отправки», забор Bord
// выключен по умолчанию. Настоящие Notion и Claude не вызываются.
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
import { moscowToday } from "@/lib/tasks/dates";
import { quarterOf } from "@/lib/goals/parse";
import type { ClaudeDeps } from "@/lib/meeting/claude";
import { ceoContext } from "@/lib/ceo/assembled";
import { dbDate } from "@/lib/tasks/dates";
import type { NotionDeps } from "@/lib/meeting/notion-api";
import type { WeekKey } from "@/domain/types";
import type { ReportBlock } from "@/lib/weekly-blocks/types";

/** Этап 66: черновик weekly для CEO по смысловым блокам */
const blk = (key: string, lines: [string, string][]): ReportBlock => ({ key, title: key, hidden: false, note: null, lines: lines.map(([product, text]) => ({ product, text, href: null, source: null })) });
const pairs = (blocks: ReportBlock[] | null | undefined, key: string) => (blocks ?? []).find((b) => b.key === key)?.lines.map((l) => [l.product, l.text]) ?? [];
const ceoText = (blocks: ReportBlock[]) => blocks.flatMap((b) => b.lines.map((l) => l.text)).join("\n");

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
const EMPTY_PAGE = "https://www.notion.so/sravni/AI-zametki-6d7e8f90123445a6b7c8d9e0f1a2b3c4";
const PARTIAL_PAGE = "https://app.notion.com/p/7e8f9012345647a8b9c0d1e2f3a4b5c6";
const SECTION = "8f901234-5678-49a0-b1c2-d3e4f5a6b7c8";
const SYNCED_PAGE = "https://www.notion.so/sravni/Sinhronizirovannyj-a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d";
const notion: NotionDeps = { fetch: fakeNotionFetch("tests/fixtures/notion"), token: "fake", base: "https://notion.fake" };

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
  await prisma.person.updateMany({ where: { slug: "ceo" }, data: { active: false } });
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
  await prisma.goal.deleteMany();
  await prisma.ceoReport.deleteMany();
  await prisma.inboxEvent.deleteMany();
});

afterAll(async () => {
  await clean();
  await prisma.$disconnect();
});

/** Запуск разбора: id строки разбора, иначе ошибка теста */
async function start(by: svc.Actor, team: string, url: string, repeat = false): Promise<string> {
  const r = await parse.startParse(by, team, key, url, { repeat });
  if (!r.id) throw new Error(`Разбор не запустился: задачи уже созданы ${r.created?.join(", ")}`);
  return r.id;
}

/** Разбор правилами встречи команды Ревы: запуск Ревой при личном входе и разбор с имитацией Notion без Claude */
async function readyParse(by?: svc.Actor, team = revaTeam, url = RULES_PAGE, deps: parse.ParseDeps = {}) {
  const id = await start(by ?? (await actorOf("Рева")), team, url);
  await parse.runParse(id, { notion, claude: null, ...deps });
  return id;
}

describe("кто запускает и видит разбор", () => {
  it("запускает ведущий: руководитель команды при личном входе или режим управления; участник и общий логин без управления нет", async () => {
    // Общий логин без режима управления видит только топ-команду и встречи не ведёт даже у руководителя
    await expectRule(parse.startParse(await teamLogin("Рева"), revaTeam, key, RULES_PAGE), /не видите/);
    await expectRule(parse.startParse(await teamLogin("Мурадян"), "top", key, RULES_PAGE), /ведёт встречу руководитель команды, руководитель выше или режим управления, при личном входе/);
    await expectRule(parse.startParse(await actorOf("Токов"), revaTeam, key, RULES_PAGE), /ведёт встречу/);
    await expectRule(parse.startParse(await actorOf("Рева"), revaTeam, key, "https://example.com/page"), /не похожа на страницу Notion/);
    await expectRule(parse.startParse(await actorOf("Рева"), revaTeam, key, "https://www.notion.so/%E0%A4%A"), /не похожа на страницу Notion/);
    const first = await parse.startParse(await actorOf("Рева"), revaTeam, key, RULES_PAGE);
    expect(first.started).toBe(true);
    // Двойное нажатие: второй разбор той же страницы не запускается
    expect(await parse.startParse(await actorOf("Рева"), revaTeam, key, RULES_PAGE)).toEqual({ id: first.id, started: false });
    // Встречи не было: разбор собрал повестку и запомнил ссылку
    const meeting = await prisma.meeting.findFirstOrThrow({ where: { teamId: revaTeam } });
    expect(meeting.notionUrl).toBe(RULES_PAGE);
    const view = await parse.getParse(await actorOf("Рева"), first.id!);
    expect(view.status).toBe("pending");
    expect(await prisma.auditLog.count({ where: { action: "meeting.parse.start", entityId: meeting.id } })).toBe(1);
  });

  it("правят только ведущие; текст страницы видят ведущие при личном входе; наблюдатель и общий логин без черновика weekly и текста", async () => {
    const id = await readyParse();
    const tokov = await parse.getParse(await actorOf("Токов"), id);
    expect(tokov).toMatchObject({ status: "ready", canEdit: false, canCreateTasks: false, canSendCeo: false, canSeeText: false, pageText: "", canSeeCeo: true });
    expect(ceoText(tokov.result.ceo)).toContain("Конверсия");
    // Собранный отчёт с цифрами, решениями и благодарностями топ-команды только отправляющим
    expect(tokov.ceoPreview).toBeNull();
    await expectRule(parse.saveParseDraft(await actorOf("Токов"), id, { ceo: [blk("products", [["osago", "Своё"]])] }), /ведёт встречу/);
    await expectRule(parse.createParseTasks(await actorOf("Токов"), id), /ведёт встречу/);
    await expectRule(parse.getParse(await actorOf("Кацемба"), id), /не видите/);
    const reva = await parse.getParse(await actorOf("Рева"), id);
    expect(reva).toMatchObject({ canEdit: true, canCreateTasks: true, canSendCeo: false, canSeeText: true, ceoPreview: null });
    expect(reva.pageText).toContain("## Задачи");
    expect(reva.sendHint).toMatch(/владелец или администратор/);

    // Наблюдатель видит все команды, но не черновик weekly для CEO и не текст страницы
    await prisma.person.update({ where: { slug: "ceo" }, data: { active: true } });
    try {
      const observer = await parse.getParse(await actorOf("CEO"), id);
      expect(observer).toMatchObject({ canSeeCeo: false, canSeeText: false, pageText: "", ceoPreview: null, canEdit: false });
      expect(observer.result.ceo).toEqual([]);
      expect(observer.result.tasks).toHaveLength(3);
    } finally {
      await prisma.person.update({ where: { slug: "ceo" }, data: { active: false } });
    }

    // Общий логин в режиме управления ведёт встречу, но черновик weekly и текст страницы ему не показаны и не правятся
    const top = await readyParse(await owner(), "top");
    const team = await parse.getParse(await teamLogin("Мурадян", "OWNER"), top);
    expect(team).toMatchObject({ canEdit: true, canSeeCeo: false, canSeeText: false, pageText: "", canSendCeo: false, canCreateTasks: false });
    const before = (await parse.getParse(await owner(), top)).result.ceo;
    await parse.saveParseDraft(await teamLogin("Мурадян", "OWNER"), top, { ceo: [blk("products", [["osago", "Подмена"]])] });
    expect((await parse.getParse(await owner(), top)).result.ceo).toEqual(before);
  });
});

describe("разбор", () => {
  it("правилами без ключа Claude: итоги, решения, риски, черновик weekly для CEO, задачи с людьми компании; нераспознанный требует выбора", async () => {
    const id = await readyParse();
    const view = await parse.getParse(await actorOf("Рева"), id);
    expect(view).toMatchObject({ status: "ready", method: "rules", title: "Встреча управления продукта 20.10" });
    expect(view.note).toMatch(/ANTHROPIC_API_KEY/);
    expect(view.result.summary).toEqual(["Конверсия в покупку ОСАГО выросла до 12%"]);
    expect(view.result.decisions).toMatchObject([{ text: "запускаем тест новой формы расчёта в ноябре", on: false }]);
    expect(view.result.risks).toEqual(["Задержка выгрузки от финансов"]);
    // Этап 66: черновик по смысловым блокам, строка подписана продуктом
    expect(pairs(view.result.ceo, "products")).toContainEqual(["osago", "Конверсия в покупку ОСАГО выросла до 12%"]);
    expect(pairs(view.result.ceo, "risks")).toEqual([["department", "Задержка выгрузки от финансов"]]);
    const [tokov, pogosova, ivanov] = view.result.tasks;
    expect(tokov).toMatchObject({ title: "собрать дашборд конверсии по СК", owner: (await person("Токов")).slug, dueGuessed: true, on: true, existing: null });
    expect(pogosova).toMatchObject({ title: "Сверка комиссий партнёров за октябрь", owner: (await person("Погосова")).slug });
    expect(ivanov).toMatchObject({ owner: null, ownerText: "Иванов" });
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
      ceo: { news: [], competitors: [], products: [{ product: "osago", text: "Конверсия 12%" }], partners: [], risks: [], plan: [{ product: "chto-to", text: "Тест формы в ноябре" }] },
      tasks: [{ title: "Собрать дашборд", outcome: "Дашборд конверсии по СК", owner: "Токов Никита Андреевич", coExecutors: ["Погосова Сабина Левоновна"], due: "" }],
    });
    const id = await start(reva, revaTeam, RULES_PAGE);
    await parse.runParse(id, { notion, claude });
    const view = await parse.getParse(reva, id);
    expect(claude.calls).toBe(1);
    expect(view).toMatchObject({ method: "ai", model: "claude-sonnet-5-5" });
    expect(view.result.summary).toEqual(["Конверсия - 12%"]);
    expect(pairs(view.result.ceo, "products")).toEqual([["osago", "Конверсия 12%"]]);
    // Чужой код продукта из ответа модели не принимается: строка подписана департаментом
    expect(pairs(view.result.ceo, "plan")).toEqual([["department", "Тест формы в ноябре"]]);
    expect(view.result.tasks[0]).toMatchObject({ owner: (await person("Токов")).slug, coExecutors: [(await person("Погосова")).slug] });
    expect(view.result.decisions[0]!.owner).toBe((await person("Рева")).slug);

    await prisma.meetingParse.deleteMany();
    const broken = fakeClaude(null, 529);
    const second = await start(reva, revaTeam, RULES_PAGE);
    await parse.runParse(second, { notion, claude: broken });
    const fallback = await parse.getParse(reva, second);
    expect(fallback.method).toBe("rules");
    expect(fallback.note).toMatch(/Claude не разобрал встречу: Claude перегружен/);
    expect(fallback.result.tasks).toHaveLength(3);
  });

  it("страница не расшарена: понятная ошибка, повторить может ведущий; событие в «Мне» тому, кто запустил", async () => {
    const reva = await actorOf("Рева");
    const id = await start(reva, revaTeam, MISSING_PAGE);
    await parse.runParse(id, { notion, claude: null });
    const view = await parse.getParse(reva, id);
    expect(view.status).toBe("failed");
    expect(view.note).toMatch(/не расшарена на интеграцию/);
    expect(view.canRetry).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "meeting.parse.fail" } })).toBeGreaterThan(0);
    // Рева и запустил, и руководит командой: одно событие
    expect(await prisma.inboxEvent.findMany({ where: { subject: `meeting-parse:${id}` }, select: { recipientId: true, text: true } })).toEqual([
      { recipientId: reva.personId, text: expect.stringMatching(/не разобрали: Notion не отдал страницу/) },
    ]);
    await expectRule(parse.retryParse(await actorOf("Токов"), id), /ведёт встречу/);
    await parse.retryParse(reva, id);
    expect((await parse.getParse(reva, id)).status).toBe("pending");
    // Нет ключа интеграции: тоже словами
    await parse.runParse(id, { notion: { ...notion, token: "" }, claude: null });
    expect((await parse.getParse(reva, id)).note).toMatch(/NOTION_TOKEN/);
  });

  it("готовый разбор: событие в «Мне» тому, кто запустил, и руководителю команды", async () => {
    const id = await readyParse(await owner());
    const events = await prisma.inboxEvent.findMany({ where: { subject: `meeting-parse:${id}` }, select: { recipientId: true, kind: true, text: true } });
    expect(events.map((e) => e.recipientId).sort()).toEqual([(await person("Мурадян")).id, (await person("Рева")).id].sort());
    expect(events[0]).toMatchObject({ kind: "MEETING", text: expect.stringMatching(/разобрана: проверьте итоги/) });
  });

  it("пустая страница и нечитаемые блоки: «не разобрано» с объяснением; частично нечитаемая разбирается, число блоков в итогах", async () => {
    const reva = await actorOf("Рева");
    const empty = await readyParse(reva, revaTeam, EMPTY_PAGE);
    const failed = await parse.getParse(reva, empty);
    expect(failed.status).toBe("failed");
    expect(failed.note).toMatch(/На странице нет текста, который можно разобрать\. 2 блока не прочитано: например, AI-заметки встречи Notion API не отдаёт/);

    const partial = await readyParse(reva, revaTeam, PARTIAL_PAGE);
    const view = await parse.getParse(reva, partial);
    expect(view.status).toBe("ready");
    expect(view.result.unreadable).toBe(2);
    expect(view.note).toMatch(/2 блока не прочитано/);
    expect(view.result.tasks).toMatchObject([{ owner: (await person("Токов")).slug, title: "обновить дашборд партнёров" }]);
  });

  it("разрешённые разделы Notion: страница под разделом разбирается, вне раздела понятный отказ", async () => {
    const reva = await actorOf("Рева");
    const ok = await readyParse(reva, revaTeam, PARTIAL_PAGE, { notion: { ...notion, allowedParents: [SECTION] } });
    expect((await parse.getParse(reva, ok)).status).toBe("ready");
    await prisma.meetingParse.deleteMany();
    const no = await readyParse(reva, revaTeam, PARTIAL_PAGE, { notion: { ...notion, allowedParents: ["11111111-2222-4333-8444-555555555555"] } });
    const view = await parse.getParse(reva, no);
    expect(view.status).toBe("failed");
    expect(view.note).toMatch(/NOTION_ALLOWED_PARENTS/);
  });

  it("отметка «жив» обновляется во время разбора, «завис» считается от неё", async () => {
    const reva = await actorOf("Рева");
    const id = await start(reva, revaTeam, RULES_PAGE);
    const slow: NotionDeps = { ...notion, fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 150));
      return notion.fetch!(input, init);
    }) as typeof fetch };
    const running = parse.runParse(id, { notion: slow, claude: null, beatMs: 40 });
    await new Promise((r) => setTimeout(r, 100));
    const first = await prisma.meetingParse.findUniqueOrThrow({ where: { id } });
    await new Promise((r) => setTimeout(r, 120));
    const second = await prisma.meetingParse.findUniqueOrThrow({ where: { id } });
    expect(first.status).toBe("PENDING");
    expect(first.lastBeatAt).not.toBeNull();
    expect(second.lastBeatAt!.getTime()).toBeGreaterThan(first.lastBeatAt!.getTime());
    await running;

    // Давно запущен, но недавно подавал признаки жизни: не завис. Давно молчит: завис, можно повторить
    const now = Date.now();
    await prisma.meetingParse.update({ where: { id }, data: { status: "PENDING", startedAt: new Date(now - 10 * 60_000), lastBeatAt: new Date(now - 10_000) } });
    expect(await parse.getParse(reva, id)).toMatchObject({ stale: false, canRetry: false });
    await prisma.meetingParse.update({ where: { id }, data: { lastBeatAt: new Date(now - 2 * 60_000) } });
    expect(await parse.getParse(reva, id)).toMatchObject({ stale: true, canRetry: true });
  });
});

describe("задачи из разбора", () => {
  it("общий логин не создаёт; нераспознанный ответственный останавливает всё; потом разом, без дублей, с согласованием этапа 54; решения по одному", async () => {
    const id = await readyParse();
    const reva = await actorOf("Рева");
    await expectRule(parse.createParseTasks(await teamLogin("Рева", "OWNER"), id), /при личном входе/);
    await expectRule(parse.createParseTasks(reva, id), /Выберите ответственного в задаче «созвониться с СК по API»: в тексте встречи «Иванов»/);
    expect(await prisma.task.count()).toBe(0);

    const view = await parse.getParse(reva, id);
    const tokovSlug = (await person("Токов")).slug;
    // Ведущий выбрал ответственного вместо нераспознанного «Иванова» и отметил решение, поправив текст
    const tasksFixed = view.result.tasks.map((t) => (t.ownerText === "Иванов" ? { ...t, owner: tokovSlug } : t));
    const decisions = view.result.decisions.map((d) => ({ ...d, on: true, text: "Запускаем тест новой формы расчёта 10 ноября" }));
    // Двойное нажатие одновременно: задачи создаются один раз
    const [a, b] = await Promise.all([parse.createParseTasks(reva, id, { tasks: tasksFixed, decisions }), parse.createParseTasks(reva, id, { tasks: tasksFixed, decisions })]);
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
    expect(await prisma.decision.findMany({ where: { meetingId: after.meetingId }, select: { text: true } })).toEqual([{ text: "Запускаем тест новой формы расчёта 10 ноября" }]);
    expect(await prisma.auditLog.findFirst({ where: { action: "meeting.parse.tasks" } })).toMatchObject({ after: expect.stringMatching(/Создано задач: 3/) });
    // После создания задач повторный разбор этой строки не запускается
    await expectRule(parse.retryParse(reva, id), /уже отправлен weekly или созданы задачи/);
  });

  it("решения по умолчанию не записываются: без отметки только задачи", async () => {
    const id = await readyParse();
    const reva = await actorOf("Рева");
    const view = await parse.getParse(reva, id);
    const res = await parse.createParseTasks(reva, id, { tasks: view.result.tasks.map((t, i) => ({ ...t, on: i === 0 })), decisions: view.result.decisions });
    expect(res).toMatchObject({ decisions: 0 });
    expect(res.numbers).toHaveLength(1);
    expect(await prisma.decision.count()).toBe(0);
  });

  it("снятые задачи не создаются, ошибка одной задачи откатывает все", async () => {
    const id = await readyParse();
    const reva = await actorOf("Рева");
    const view = await parse.getParse(reva, id);
    const pastDue = view.result.tasks.map((t, i) => ({ ...t, on: i < 2, due: i === 1 ? "2020-01-01" : t.due }));
    await expectRule(parse.createParseTasks(reva, id, { tasks: pastDue }), /Задача «Сверка комиссий партнёров за октябрь»: Срок не может быть в прошлом/);
    expect(await prisma.task.count()).toBe(0);
    const ok = view.result.tasks.map((t, i) => ({ ...t, on: i === 0 }));
    const res = await parse.createParseTasks(reva, id, { tasks: ok });
    expect(res.numbers).toHaveLength(1);
  });

  it("повторный разбор той же страницы: предупреждение с номерами, похожие черновики сняты и помечены", async () => {
    const reva = await actorOf("Рева");
    const id = await readyParse(reva);
    const view = await parse.getParse(reva, id);
    const tokovSlug = (await person("Токов")).slug;
    const made = await parse.createParseTasks(reva, id, { tasks: view.result.tasks.map((t) => (t.ownerText === "Иванов" ? { ...t, owner: tokovSlug } : t)) });
    expect(await parse.startParse(reva, revaTeam, key, RULES_PAGE)).toEqual({ id: null, started: false, created: made.numbers });
    const second = await start(reva, revaTeam, RULES_PAGE, true);
    await parse.runParse(second, { notion, claude: null });
    const again = await parse.getParse(reva, second);
    const [tokov, pogosova, ivanov] = again.result.tasks;
    const byTitle = async (title: string) => (await prisma.task.findFirstOrThrow({ where: { title } })).number;
    expect(tokov).toMatchObject({ on: false, existing: await byTitle("собрать дашборд конверсии по СК") });
    expect(pogosova).toMatchObject({ on: false, existing: await byTitle("Сверка комиссий партнёров за октябрь") });
    // Ответственного у «Иванова» снова нет: без того же ответственного это не та же задача
    expect(ivanov).toMatchObject({ on: true, existing: null });
    expect(await prisma.auditLog.findFirst({ where: { action: "meeting.parse.start" }, orderBy: { id: "desc" } })).toMatchObject({ after: expect.stringMatching(/Повторный разбор: задачи .* уже созданы/) });
  });

  it("цель задачи: черновик показывает ту же цель, что получит задача; недопустимая цель подбирается заново", async () => {
    const quarter = quarterOf(moscowToday());
    const goal = await prisma.goal.create({ data: { quarter, code: "ПР-1", title: "Дашборд конверсии по страховым компаниям", teamId: revaTeam, source: "manual" } });
    const finTeam = await prisma.team.findFirstOrThrow({ where: { leader: { fullName: { startsWith: "Кацемба" } }, kind: "UNIT" } });
    const foreign = await prisma.goal.create({ data: { quarter, code: "ФН-1", title: "Закрытие месяца за три дня", teamId: finTeam.id, source: "manual" } });
    const reva = await actorOf("Рева");
    const id = await readyParse(reva);
    const view = await parse.getParse(reva, id);
    expect(view.result.tasks[0]).toMatchObject({ goal: goal.id, goalTitle: "ПР-1. Дашборд конверсии по страховым компаниям" });
    // Цель чужой команды в черновике: экран и создание подбирают заново по тому же правилу
    await parse.saveParseDraft(reva, id, { tasks: view.result.tasks.map((t, i) => (i === 0 ? { ...t, goal: foreign.id } : t)) }, view.updatedAt);
    const edited = await parse.getParse(reva, id);
    expect(edited.result.tasks[0]!.goal).toBe(goal.id);
    const res = await parse.createParseTasks(reva, id, { tasks: edited.result.tasks.map((t, i) => ({ ...t, on: i === 0 })) });
    expect((await prisma.task.findUniqueOrThrow({ where: { number: res.numbers[0] } })).goalId).toBe(goal.id);
  });
});

describe("weekly для CEO", () => {
  const DRAFT = [blk("products", [["osago", "Конверсия 12%"]]), blk("risks", [["department", "Задержка выгрузки"]]), blk("plan", [["department", "Тест формы в ноябре"]])];

  it("отправляет владелец или администратор в режиме управления при личном входе; CEO руководитель компании, событие в «Мне», собранный отчёт по блокам", async () => {
    const id = await readyParse(await owner(), "top");
    await expectRule(parse.sendParseToCeo(await actorOf("Рева"), id, { ceo: DRAFT }), /ведёт встречу|владелец или администратор/);
    await expectRule(parse.sendParseToCeo(await teamLogin("Мурадян", "OWNER"), id, { ceo: DRAFT }), /при личном входе/);
    await expectRule(parse.sendParseToCeo(await actorOf("Мурадян"), id, { ceo: DRAFT }), /владелец или администратор в режиме управления/);
    await expectRule(parse.sendParseToCeo(await owner(), id, { ceo: [blk("products", [])] }), /пустой/);

    const view = await parse.sendParseToCeo(await owner(), id, { ceo: DRAFT });
    expect(view.statusLabel).toBe("Отправлено CEO");
    expect(view.ceoPreview?.week).toBe(key);
    const krainik = await actorOf("Крайник");
    const report = await weekly.getCeoReport(key);
    // Отчёта за неделю не было: черновик дописан к свежей автосборке, CEO получает отчёт целиком по стандартным блокам
    expect(report.blocks!.map((b) => b.key)).toEqual(["news", "wow", "month", "competitors", "products", "partners", "risks", "plan"]);
    expect(pairs(report.blocks, "products")).toContainEqual(["osago", "Конверсия 12%"]);
    expect(pairs(report.blocks, "risks")).toContainEqual(["department", "Задержка выгрузки"]);
    expect(pairs(report.blocks, "plan")).toContainEqual(["department", "Тест формы в ноябре"]);
    expect(report.sections!.next).toContain("- Департамент. Тест формы в ноябре");
    expect(report.sent).toMatchObject({ by: "Мурадян Арам", to: ["Крайник Александр"] });
    const inbox = await listInbox(krainik.personId);
    expect(inbox.items.find((i) => i.subject === `ceo-report:${key}`)).toMatchObject({ kind: "MEETING", text: expect.stringMatching(/отправил weekly для CEO/) });
    // CEO видит собранный отчёт только для чтения и только при личном входе; цифры по его уровню (у генерального все)
    const seen = await parse.ceoSentReports(krainik, key);
    // Скрытые блоки (конкуренты без новостей) CEO не уходят
    expect(seen?.current).toMatchObject({ blocks: report.blocks!.filter((b) => !b.hidden), sentBy: "Мурадян Арам", editedAfter: false });
    expect(seen?.current?.ctx).toMatchObject({ week: key, level: "full" });
    expect(await parse.ceoSentReports({ ...krainik, via: "TEAM" }, key)).toBeNull();
    expect(await parse.ceoSentReports(await actorOf("Токов"))).toBeNull();
    expect(await prisma.auditLog.findFirst({ where: { action: "meeting.parse.ceo" } })).toMatchObject({ after: expect.stringMatching(/Отправлен в приложении: Крайник Александр. Новый отчёт/) });
    // Черновик разбора помнит, что ушло
    expect(pairs((await parse.getParse(await owner(), id)).result.ceo, "products")).toEqual([["osago", "Конверсия 12%"]]);
  });

  it("правка после отправки: отметка честная, CEO видит отправленный снимок", async () => {
    const id = await readyParse(await owner(), "top");
    await parse.sendParseToCeo(await owner(), id, { ceo: [blk("news", [["department", "Отправленная версия"]])] });
    const row = await prisma.ceoReport.findFirstOrThrow();
    expect(row.sentAt!.getTime()).toBe(row.updatedAt.getTime());
    const krainik = await actorOf("Крайник");
    expect((await parse.ceoSentReports(krainik, key))?.current?.editedAfter).toBe(false);
    await weekly.saveCeoReport(await owner(), key, { main: "- Поправили после отправки", risks: "", next: "" });
    const after = await parse.ceoSentReports(krainik, key);
    expect(after?.current?.editedAfter).toBe(true);
    expect(pairs(after?.current?.blocks, "news")).toContainEqual(["department", "Отправленная версия"]);
  });

  it("отчёт недели уже есть: без выбора и по устаревшему экрану не отправляется; дописать по блокам или заменить блоки черновика", async () => {
    const id = await readyParse(await owner(), "top");
    const saved = await weekly.saveCeoReport(await owner(), key, { main: "- Бюджет 2027 защищён", risks: "", next: "- Встреча с СК" }, [{ title: "Встреча с ВСК", text: "Договорились о планах." }]);
    const draft = [blk("products", [["osago", "Конверсия 12%"]]), blk("risks", [["department", "Задержка выгрузки"]]), blk("plan", [["department", "встреча с СК"]])];
    await expectRule(parse.sendParseToCeo(await owner(), id, { ceo: draft, expected: saved.updatedAt }), /выберите, дописать/);
    await expectRule(parse.sendParseToCeo(await owner(), id, { ceo: draft, mode: "merge", expected: "2020-01-01T00:00:00.000Z" }), /поменялся/);
    const view = await parse.getParse(await owner(), id);
    expect(view.ceo?.existing.updatedAt).toBe(saved.updatedAt);
    // Старый отчёт (разделы) разложен по блокам: к нему и пойдёт черновик
    expect(pairs(view.ceo?.base, "news")).toEqual([["department", "Бюджет 2027 защищён"]]);
    expect(pairs(view.ceo?.base, "plan")).toEqual([["department", "Встреча с СК"]]);
    await parse.sendParseToCeo(await owner(), id, { ceo: draft, mode: "merge", expected: saved.updatedAt });
    const merged = await weekly.getCeoReport(key);
    expect(pairs(merged.blocks, "news")).toEqual([["department", "Бюджет 2027 защищён"]]);
    expect(pairs(merged.blocks, "products")).toEqual([["osago", "Конверсия 12%"]]);
    expect(pairs(merged.blocks, "risks")).toEqual([["department", "Задержка выгрузки"]]);
    // Та же строка второй раз не попадает
    expect(pairs(merged.blocks, "plan")).toEqual([["department", "Встреча с СК"]]);
    expect(merged.meetings).toEqual([{ title: "Встреча с ВСК", text: "Договорились о планах." }]);
    // Снимок того, что ушло CEO: блоки после слияния и «Мои встречи»
    const seen = await parse.ceoSentReports(await actorOf("Крайник"), key);
    expect(seen?.current).toMatchObject({ blocks: merged.blocks!.filter((b) => !b.hidden), meetings: merged.meetings });
    await parse.sendParseToCeo(await owner(), id, { ceo: draft, mode: "replace", expected: merged.updatedAt });
    const replaced = await weekly.getCeoReport(key);
    // Пустой блок черновика ничего не заменяет: новости отчёта остались
    expect(pairs(replaced.blocks, "news")).toEqual([["department", "Бюджет 2027 защищён"]]);
    expect(pairs(replaced.blocks, "plan")).toEqual([["department", "встреча с СК"]]);
    expect(replaced.meetings).toEqual(merged.meetings);
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

describe("второй круг проверки", () => {
  it("решения и благодарности топ-команды: в предпросмотре только у отправляющих, рядовой участник их не получает", async () => {
    const top = await readyParse(await owner(), "top");
    const meetingId = (await prisma.meetingParse.findUniqueOrThrow({ where: { id: top } })).meetingId;
    const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId } });
    await prisma.decision.create({ data: { meetingId, teamId: "top", text: "Бюджет КАСКО утверждаем на встрече 28.10", date: meeting.date } });
    const week = await prisma.week.findUniqueOrThrow({ where: { start: dbDate(key) } });
    await prisma.weeklyReport.upsert({
      where: { weekId_authorId: { weekId: week.id, authorId: (await person("Рева")).id } },
      update: { thanks: "Спасибо финансам за быструю сверку" },
      create: { weekId: week.id, authorId: (await person("Рева")).id, thanks: "Спасибо финансам за быструю сверку" },
    });
    try {
      const sender = await parse.getParse(await owner(), top);
      expect(sender.ceoPreview?.decisions.map((d) => d.text)).toContain("Бюджет КАСКО утверждаем на встрече 28.10");
      expect(sender.ceoPreview?.thanks.map((t) => t.text)).toContain("Спасибо финансам за быструю сверку");
      // Рядовой участник команды не из топ-команды: ни решений, ни благодарностей топ-команды
      const tokov = await ceoContext(await actorOf("Токов"), key);
      expect(tokov).toMatchObject({ decisions: [], thanks: [] });
      const own = await readyParse();
      expect((await parse.getParse(await actorOf("Токов"), own)).ceoPreview).toBeNull();
      expect((await parse.getParse(await actorOf("Рева"), own)).ceoPreview).toBeNull();
    } finally {
      await prisma.weeklyReport.deleteMany({ where: { weekId: week.id, authorId: (await person("Рева")).id } });
    }
  });

  it("NOTION_ALLOWED_PARENTS без единого ID: разбор закрыт с понятным текстом", async () => {
    const reva = await actorOf("Рева");
    const id = await readyParse(reva, revaTeam, RULES_PAGE, { notion: { ...notion, allowedInvalid: true } });
    const view = await parse.getParse(reva, id);
    expect(view.status).toBe("failed");
    expect(view.note).toMatch(/NOTION_ALLOWED_PARENTS задана, но в ней нет ни одного ID/);
  });

  it("родитель страницы: 404 или 403 значит «не в разрешённом разделе», сбой Notion остаётся сбоем", async () => {
    const reva = await actorOf("Рева");
    const parentFails = (status: number): NotionDeps => ({
      ...notion,
      allowedParents: [SECTION],
      fetch: (async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes("/v1/databases/") ? new Response(JSON.stringify({ code: "x" }), { status }) : notion.fetch!(input, init)) as typeof fetch,
    });
    const broken = await readyParse(reva, revaTeam, PARTIAL_PAGE, { notion: parentFails(502) });
    expect((await parse.getParse(reva, broken)).note).toMatch(/^Notion не ответил/);
    await prisma.meetingParse.deleteMany();
    const hidden = await readyParse(reva, revaTeam, PARTIAL_PAGE, { notion: parentFails(404) });
    expect((await parse.getParse(reva, hidden)).note).toMatch(/NOTION_ALLOWED_PARENTS/);
  });

  it("копия синхронизированного блока с другой страницы: с разрешёнными разделами не читается, без них читается", async () => {
    const reva = await actorOf("Рева");
    const open = await readyParse(reva, revaTeam, SYNCED_PAGE);
    expect((await parse.getParse(reva, open)).pageText).toContain("Текст с другой страницы");
    await prisma.meetingParse.deleteMany();
    const closed = await readyParse(reva, revaTeam, SYNCED_PAGE, { notion: { ...notion, allowedParents: [SECTION] } });
    const view = await parse.getParse(reva, closed);
    expect(view.status).toBe("ready");
    expect(view.pageText).not.toContain("Текст с другой страницы");
    expect(view.result.unreadable).toBe(1);
    expect(view.note).toMatch(/копии синхронизированных блоков с других страниц \(1\) не читаются, пока задана NOTION_ALLOWED_PARENTS/);
  });

  it("повтор одновременно с созданием задач или отправкой CEO: проходит что-то одно", async () => {
    const reva = await actorOf("Рева");
    const id = await readyParse(reva);
    const view = await parse.getParse(reva, id);
    const tokovSlug = (await person("Токов")).slug;
    const tasks = view.result.tasks.map((t) => (t.ownerText === "Иванов" ? { ...t, owner: tokovSlug } : t));
    const [retry, create] = await Promise.allSettled([parse.retryParse(reva, id), parse.createParseTasks(reva, id, { tasks })]);
    expect([retry.status, create.status].filter((x) => x === "fulfilled")).toHaveLength(1);
    const row = await prisma.meetingParse.findUniqueOrThrow({ where: { id } });
    if (create.status === "fulfilled") expect(row).toMatchObject({ status: "READY" });
    else expect(await prisma.task.count()).toBe(0);
    expect(row.tasksCreatedAt !== null).toBe(create.status === "fulfilled");

    const top = await readyParse(await owner(), "top");
    const [again, send] = await Promise.allSettled([parse.retryParse(await owner(), top), parse.sendParseToCeo(await owner(), top, { ceo: { main: "- Главное", risks: "", next: "" } })]);
    expect([again.status, send.status].filter((x) => x === "fulfilled")).toHaveLength(1);
    const topRow = await prisma.meetingParse.findUniqueOrThrow({ where: { id: top } });
    expect(topRow.ceoSentAt !== null).toBe(send.status === "fulfilled");
    expect(await prisma.ceoReport.count()).toBe(send.status === "fulfilled" ? 1 : 0);
  });

  it("зависший разбор: в списке встречи «Завис», новый разбор той же страницы закрывает его", async () => {
    const reva = await actorOf("Рева");
    const old = await start(reva, revaTeam, RULES_PAGE);
    await prisma.meetingParse.update({ where: { id: old }, data: { startedAt: new Date(Date.now() - 10 * 60_000), lastBeatAt: new Date(Date.now() - 5 * 60_000) } });
    expect((await parse.listParses(reva, revaTeam, key)).find((p) => p.id === old)?.status).toBe("Завис");
    const fresh = await start(reva, revaTeam, RULES_PAGE);
    expect(fresh).not.toBe(old);
    expect(await prisma.meetingParse.findUniqueOrThrow({ where: { id: old } })).toMatchObject({ status: "FAILED", note: "Прервано: запущен новый разбор этой страницы" });
  });

  it("событие о готовности после повтора уходит тому, кто нажал «Повторить», и руководителю команды", async () => {
    const reva = await actorOf("Рева");
    const id = await readyParse(reva, revaTeam, MISSING_PAGE);
    await prisma.inboxEvent.deleteMany();
    const own = await owner();
    await parse.retryParse(own, id);
    await parse.runParse(id, { notion, claude: null });
    const to = (await prisma.inboxEvent.findMany({ where: { subject: `meeting-parse:${id}` }, select: { recipientId: true } })).map((e) => e.recipientId).sort();
    expect(to).toEqual([own.personId, reva.personId].sort());
    expect((await parse.getParse(own, id)).startedBy).toBe("Мурадян Арам");
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
