import { describe, expect, it } from "vitest";
import {
  REPORT_COMMENT_MAX,
  REPORT_TABS,
  canReplyComment,
  canStartComment,
  cleanCommentText,
  commentSubject,
  defaultTab,
  findLine,
  isReportTab,
  parseCommentSubject,
  reportHref,
  reportRoles,
  seesComments,
} from "@/lib/leader-report/rules";
import { SUBMIT_WEEKS, SUBMIT_WEEK_LABEL, closedWeekHint, sentReportsWarning, submitWeekOf, submitWeekState } from "@/lib/weekly/rules";
import { isWeekKey } from "@/lib/weekly/weeks";
import { NUMBERS_HIDDEN_TEXT, isFiguresPlaceholder } from "@/lib/weekly-blocks/types";
import { MAIN_NAV, visibleGroups } from "@/components/shell/nav";

// Этап 73+81: отчёт руководителю (вкладки, роли, комментарии) и weekly за прошлые недели. Чистые правила: их считают и
// сервер, и экраны

describe("вкладки раздела «Отчёт руководителю»", () => {
  it("две вкладки, отправленные и полученные", () => {
    expect(REPORT_TABS).toEqual(["sent", "received"]);
    expect(isReportTab("sent")).toBe(true);
    expect(isReportTab("received")).toBe(true);
    expect(isReportTab("current")).toBe(false);
    expect(isReportTab(null)).toBe(false);
  });

  it("по умолчанию руководитель видит «Отправленные», только получатель - «Полученные»", () => {
    expect(defaultTab({ canLead: true, hasSent: false, hasReceived: true })).toBe("sent");
    expect(defaultTab({ canLead: false, hasSent: true, hasReceived: true })).toBe("sent");
    expect(defaultTab({ canLead: false, hasSent: false, hasReceived: true })).toBe("received");
    // Ни того ни другого: открывается «Отправленные» с пустым состоянием
    expect(defaultTab({ canLead: false, hasSent: false, hasReceived: false })).toBe("sent");
  });

  it("адрес вкладки сохраняет неделю и команду", () => {
    expect(reportHref("sent")).toBe("/leader-report?tab=sent");
    expect(reportHref("received", { week: "2026-10-26" })).toBe("/leader-report?tab=received&week=2026-10-26");
    expect(reportHref("received", { week: "2026-10-26", team: "top" })).toBe("/leader-report?tab=received&week=2026-10-26&team=top");
  });

  it("пункт меню «Отчёт руководителю» виден только тем, кому раздел открыт", () => {
    const hrefs = (leaderReport: boolean) => visibleGroups({ market: false, leaderReport }).flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs(true)).toContain("/leader-report");
    expect(hrefs(false)).not.toContain("/leader-report");
    expect(MAIN_NAV.find((i) => i.href === "/leader-report")?.restricted).toBe("leaderReport");
  });
});

describe("роли у отправленного отчёта", () => {
  const report = { leaderId: "lead", sentById: "lead", to: [{ id: "boss" }] };

  it("автор это руководитель команды и тот, кто отправил; получатель это адресат; оба только при личном входе", () => {
    expect(reportRoles({ personId: "lead", via: "PASSWORD", management: null }, report)).toEqual({ author: true, recipient: false, owner: false });
    expect(reportRoles({ personId: "boss", via: "PASSWORD", management: null }, report)).toEqual({ author: false, recipient: true, owner: false });
    // Отправил не руководитель, а администратор: он тоже автор
    expect(reportRoles({ personId: "admin", via: "PASSWORD", management: "ADMIN" }, { ...report, sentById: "admin" })).toEqual({ author: true, recipient: false, owner: false });
    // Общий логин: ни автор, ни получатель, профиль по нему выбирают сами
    expect(reportRoles({ personId: "lead", via: "TEAM", management: "OWNER" }, report)).toEqual({ author: false, recipient: false, owner: true });
  });

  it("комментарии видят автор, получатель и владелец; начинает получатель, отвечают обе стороны", () => {
    const lead = reportRoles({ personId: "lead", via: "PASSWORD", management: null }, report);
    const boss = reportRoles({ personId: "boss", via: "PASSWORD", management: null }, report);
    const owner = reportRoles({ personId: "owner", via: "PASSWORD", management: "OWNER" }, report);
    const member = reportRoles({ personId: "member", via: "PASSWORD", management: null }, report);
    expect([seesComments(lead), seesComments(boss), seesComments(owner), seesComments(member)]).toEqual([true, true, true, false]);
    expect([canStartComment(lead), canStartComment(boss), canStartComment(owner)]).toEqual([false, true, false]);
    expect([canReplyComment(lead), canReplyComment(boss), canReplyComment(owner)]).toEqual([true, true, false]);
  });
});

describe("текст комментария", () => {
  it("длинное тире и стрелки становятся дефисом, пробелы по краям убраны", () => {
    expect(cleanCommentText("  Цифры — поправьте  ")).toBe("Цифры - поправьте");
    expect(cleanCommentText("ОСАГО → КАСКО")).toBe("ОСАГО - КАСКО");
    expect(cleanCommentText(42)).toBe("");
    expect(cleanCommentText("   ")).toBe("");
  });

  it("предел знаков задан", () => {
    expect(REPORT_COMMENT_MAX).toBe(1000);
  });
});

describe("строка отчёта, к которой написан комментарий", () => {
  const blocks = [
    { key: "risks", lines: [{ text: "Первая" }, { text: "Вторая" }] },
    { key: "plan", lines: [{ text: "Третья" }] },
  ];

  it("место из комментария, если текст на нём совпадает, иначе первое совпадение по тексту", () => {
    expect(findLine(blocks, "risks", "Вторая", 1)).toBe(1);
    // Строки сдвинулись: место другое, текст тот же
    expect(findLine(blocks, "risks", "Вторая", 0)).toBe(1);
    expect(findLine(blocks, "plan", "Третья")).toBe(0);
  });

  it("строки больше нет или блока нет: -1", () => {
    expect(findLine(blocks, "risks", "Убрали", 0)).toBe(-1);
    expect(findLine(blocks, "numbers", "Первая", 0)).toBe(-1);
  });
});

describe("строка вместо закрытых цифр", () => {
  it("это не строка отчёта: её не хранят и к ней не оставляют комментарий", () => {
    expect(isFiguresPlaceholder({ text: NUMBERS_HIDDEN_TEXT, href: null })).toBe(true);
    // Со ссылкой это настоящая строка, просто с таким же текстом
    expect(isFiguresPlaceholder({ text: NUMBERS_HIDDEN_TEXT, href: "/forecast" })).toBe(false);
    expect(isFiguresPlaceholder({ text: "ОСАГО: заявок 12 345", href: null })).toBe(false);
  });

  it("цитата строки разрешается по блокам читателя: закрытой строки в них нет", () => {
    // Так блоки видит зритель без доступа к цифрам: вместо строки с цифрами пометка
    const hidden = [{ key: "wow", lines: [{ text: NUMBERS_HIDDEN_TEXT }] }];
    const full = [{ key: "wow", lines: [{ text: "ОСАГО: заявок 12 345" }] }];
    expect(findLine(full, "wow", "ОСАГО: заявок 12 345", 0)).toBe(0);
    expect(findLine(hidden, "wow", "ОСАГО: заявок 12 345", 0)).toBe(-1);
  });
});

describe("предмет события о комментарии", () => {
  it("склеивается и разбирается, автору в «Отправленные», получателю в «Полученные»", () => {
    expect(commentSubject("sent", "top", "2026-10-26")).toBe("report-comment:sent:top:2026-10-26");
    expect(parseCommentSubject("report-comment:received:t1:2026-10-26")).toEqual({ side: "received", teamId: "t1", week: "2026-10-26" });
    expect(parseCommentSubject("report-comment:other:t1:2026-10-26")).toBeNull();
    expect(parseCommentSubject("team-report:t1:2026-10-26")).toBeNull();
  });
});

describe("weekly за прошлые недели", () => {
  it("неделя экрана сдачи по адресу: кривая и будущая дают отчётную", () => {
    expect(submitWeekOf("2026-10-19", "2026-10-26", isWeekKey)).toEqual({ key: "2026-10-19", future: false });
    expect(submitWeekOf(undefined, "2026-10-26", isWeekKey)).toEqual({ key: "2026-10-26", future: false });
    // Не понедельник: не ключ недели
    expect(submitWeekOf("2026-10-20", "2026-10-26", isWeekKey)).toEqual({ key: "2026-10-26", future: false });
    expect(submitWeekOf("2026-11-02", "2026-10-26", isWeekKey)).toEqual({ key: "2026-10-26", future: true });
  });

  it("состояние недели в переключателе: закрытая неделя поверх несданного, сданный остаётся сданным", () => {
    expect(submitWeekState("not-started", true)).toBe("closed");
    expect(submitWeekState("draft", true)).toBe("closed");
    expect(submitWeekState("submitted", true)).toBe("submitted");
    expect(submitWeekState("late", true)).toBe("late");
    expect(submitWeekState("draft", false)).toBe("draft");
    expect(SUBMIT_WEEK_LABEL.closed).toBe("закрыта");
    expect(SUBMIT_WEEKS).toBe(8);
  });

  it("предупреждение, если отчёт руководителю за неделю уже ушёл", () => {
    expect(sentReportsWarning([], 43)).toBeNull();
    const one = sentReportsWarning([{ team: "Продукты", at: "2026-10-27T15:05:00.000Z", to: ["Фатьянов Иван"] }], 43);
    expect(one).toContain("Отчёт руководителю за неделю 43 уже отправлен");
    expect(one).toContain("команда «Продукты»");
    expect(one).toContain("получил Фатьянов Иван");
    expect(one).toContain("в отправленную версию сами не войдут");
    const two = sentReportsWarning(
      [
        { team: "Продукты", at: "2026-10-27T15:05:00.000Z", to: [] },
        { team: "Продажи", at: "2026-10-27T16:05:00.000Z", to: [] },
      ],
      43,
    );
    expect(two).toContain("Отчёты руководителю за неделю 43 уже отправлены");
  });

  it("кто закрыл неделю и кто может открыть", () => {
    expect(closedWeekHint(43, true, [])).toContain("закрыта после встречи");
    expect(closedWeekHint(43, true, [])).toContain("владелец или администратор в режиме управления");
    const one = closedWeekHint(43, false, [{ name: "Продукты", leader: "Рева Тарас" }]);
    expect(one).toContain("закрыл руководитель команды «Продукты» (Рева Тарас)");
    const many = closedWeekHint(43, false, [
      { name: "Продукты", leader: null },
      { name: "Продажи", leader: "Головкин Пётр" },
    ]);
    expect(many).toContain("закрыли руководители команд «Продукты», «Продажи» (Головкин Пётр)");
  });
});
