// Этап 73: правила недель сдачи, «сдан задним числом», предупреждение про отправленный отчёт, получатель отчёта
// руководителю, вкладки и права на комментарии.
import { describe, expect, it } from "vitest";
import { canEditWeekly, closedWeekHint, sentReportsWarning, submitWeekOf, submitWeekState, SUBMIT_WEEK_LABEL } from "@/lib/weekly/rules";
import { isWeekKey } from "@/lib/weekly/weeks";
import { canReplyComment, canStartComment, cleanCommentText, commentSubject, defaultTab, findLine, isReportTab, recipientCandidates, reportRoles, seesComments } from "@/lib/leader-report/rules";
import { pathOf, reportHref } from "@/lib/letters/phrases";
import { entryDrafts, putEntryDraft, putHeadlineDraft, headlineDraft, type KeyValue } from "@/lib/offline/drafts";
import type { PersonSlug } from "@/domain/types";

const R = "2026-10-26";

describe("неделя экрана сдачи", () => {
  it("без недели и с кривой неделей отчётная, будущая неделя тоже отчётная с пометкой, прошлая как есть", () => {
    expect(submitWeekOf(undefined, R, isWeekKey)).toEqual({ key: R, future: false });
    expect(submitWeekOf("2026-10-27", R, isWeekKey)).toEqual({ key: R, future: false });
    expect(submitWeekOf("2026-11-02", R, isWeekKey)).toEqual({ key: R, future: true });
    expect(submitWeekOf("2026-10-12", R, isWeekKey)).toEqual({ key: "2026-10-12", future: false });
  });

  it("состояние недели: закрытая без сданного weekly «закрыта», сданный остаётся сданным", () => {
    expect(submitWeekState("not-started", true)).toBe("closed");
    expect(submitWeekState("draft", true)).toBe("closed");
    expect(submitWeekState("late", true)).toBe("late");
    expect(submitWeekState("draft", false)).toBe("draft");
    expect(SUBMIT_WEEK_LABEL["not-started"]).toBe("не сдан");
  });

  it("закрытую неделю свой несданный weekly правят задним числом, сданный нет; будущую нельзя; управление всегда", () => {
    const me = { slug: "reva" as PersonSlug, management: null, observer: false };
    expect(canEditWeekly({ key: "2026-10-12", closed: true, retroOpen: true }, R, me, me.slug)).toBe(true);
    expect(canEditWeekly({ key: "2026-10-12", closed: true, retroOpen: false }, R, me, me.slug)).toBe(false);
    expect(canEditWeekly({ key: "2026-10-12", closed: true, retroOpen: true }, R, me, "loginova" as PersonSlug)).toBe(false);
    expect(canEditWeekly({ key: "2026-11-02", closed: false }, R, me, me.slug)).toBe(false);
    expect(canEditWeekly({ key: "2026-10-12", closed: true }, R, { ...me, management: "ADMIN" }, "loginova" as PersonSlug)).toBe(true);
    expect(canEditWeekly({ key: "2026-10-12", closed: false }, R, { ...me, observer: true }, me.slug)).toBe(false);
  });

  it("предупреждение про отправленный отчёт называет команду, время и получателя; без отчётов его нет", () => {
    expect(sentReportsWarning([], 42)).toBeNull();
    const text = sentReportsWarning([{ team: "Вклады", at: "2026-10-20T15:05:00Z", to: ["Рева Тарас"] }], 42)!;
    expect(text).toMatch(/^Отчёт руководителю за неделю 42 уже отправлен \(команда «Вклады», 20 октября, 18:05, получил Рева Тарас\)/);
    expect(text).toMatch(/в отправленный отчёт сами не войдут/);
    expect(text).not.toMatch(/[—–→·]/);
  });

  it("кто может открыть закрытую неделю", () => {
    expect(closedWeekHint(41, true, [])).toMatch(/владелец или администратор/);
    expect(closedWeekHint(41, false, [{ name: "Вклады", leader: "Рева Тарас" }])).toMatch(/руководитель команды «Вклады» \(Рева Тарас\)/);
  });
});

describe("получатель и права отчёта руководителю", () => {
  const nodes = [
    { id: "up", active: true, leaderId: "boss" },
    { id: "off", active: false, leaderId: "ghost" },
  ];
  it("руководитель команды выше, затем руководитель по структуре; сам себе не получатель", () => {
    expect(recipientCandidates({ parentId: "up", leaderId: "lead" }, nodes, "mgr")).toEqual(["boss", "mgr"]);
    expect(recipientCandidates({ parentId: "off", leaderId: "lead" }, nodes, "mgr")).toEqual(["mgr"]);
    expect(recipientCandidates({ parentId: "up", leaderId: "boss" }, nodes, "mgr")).toEqual(["mgr"]);
    expect(recipientCandidates({ parentId: null, leaderId: "lead" }, nodes, "lead")).toEqual([]);
  });

  it("вкладка по умолчанию: ведущий на текущей неделе, получатель в полученных", () => {
    expect(defaultTab({ canLead: true, recipient: false, hasReceived: true })).toBe("current");
    expect(defaultTab({ canLead: false, recipient: true, hasReceived: true })).toBe("received");
    expect(defaultTab({ canLead: false, recipient: false, hasReceived: true })).toBe("received");
    expect(defaultTab({ canLead: false, recipient: false, hasReceived: false })).toBe("current");
    expect(isReportTab("sent")).toBe(true);
    expect(isReportTab("ceo")).toBe(false);
  });

  it("роли: автор (руководитель и отправивший), получатель только при личном входе, владелец в режиме управления", () => {
    const report = { leaderId: "lead", sentById: "admin", to: [{ id: "boss" }] };
    expect(reportRoles({ personId: "boss", via: "PASSWORD", management: null }, report)).toEqual({ author: false, recipient: true, owner: false });
    expect(reportRoles({ personId: "boss", via: "TEAM", management: null }, report)).toEqual({ author: false, recipient: false, owner: false });
    expect(reportRoles({ personId: "admin", via: "PASSWORD", management: "ADMIN" }, report)).toEqual({ author: true, recipient: false, owner: false });
    expect(reportRoles({ personId: "x", via: "TEAM", management: "OWNER" }, report)).toEqual({ author: false, recipient: false, owner: true });
    const member = reportRoles({ personId: "member", via: "PASSWORD", management: null }, report);
    expect(seesComments(member)).toBe(false);
    expect(canStartComment({ author: true, recipient: false, owner: true })).toBe(false);
    expect(canReplyComment({ author: true, recipient: false, owner: false })).toBe(true);
    expect(canReplyComment({ author: false, recipient: false, owner: true })).toBe(false);
  });

  it("строка комментария находится по месту и тексту, убранная строка не находится", () => {
    const blocks = [{ key: "products", lines: [{ text: "А" }, { text: "Б" }, { text: "Б" }] }];
    expect(findLine(blocks, "products", "Б", 2)).toBe(2);
    expect(findLine(blocks, "products", "Б", 0)).toBe(1);
    expect(findLine(blocks, "products", "В")).toBe(-1);
    expect(findLine(blocks, "risks", "А")).toBe(-1);
    expect(cleanCommentText("  Цифра — где? → завтра ")).toBe("Цифра - где? - завтра");
  });

  it("события и письма ведут в раздел «Отчёт руководителю»: автору в отправленные, получателю в полученные", () => {
    expect(reportHref(commentSubject("sent", "t1", "2026-10-19"))).toBe("/leader-report?tab=sent&team=t1&week=2026-10-19");
    expect(reportHref(commentSubject("received", "t1", "2026-10-19"))).toBe("/leader-report?tab=received&team=t1&week=2026-10-19");
    expect(reportHref("ceo-report:2026-10-19")).toBe("/leader-report?tab=received&team=top&week=2026-10-19");
    expect(reportHref("team-report:t1:2026-10-19")).toBe("/leader-report?tab=received&team=t1&week=2026-10-19");
    expect(pathOf({ taskNumber: null, entryId: null, subject: "team-report:t1:2026-10-19" })).toBe("/leader-report?tab=received&team=t1&week=2026-10-19");
    expect(pathOf({ taskNumber: null, entryId: null, subject: "weekly-remind:2026-10-19" })).toBe("/weekly/submit?week=2026-10-19");
  });
});

describe("черновики на устройстве по неделям", () => {
  function memory(): KeyValue {
    const m = new Map<string, string>();
    return {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
      key: (i) => [...m.keys()][i] ?? null,
      get length() {
        return m.size;
      },
    };
  }
  it("черновики записей и главной фразы двух недель не смешиваются", () => {
    const kv = memory();
    const input = (week: string, what: string) => ({ week, direction: "osago", block: "product", type: "event", what, links: [] });
    putEntryDraft("reva", { key: "a", entryId: null, clientKey: "a", input: input("2026-10-12", "Прошлая"), savedAt: Date.now() }, kv);
    putEntryDraft("reva", { key: "b", entryId: null, clientKey: "b", input: input("2026-10-19", "Отчётная"), savedAt: Date.now() }, kv);
    putHeadlineDraft("reva", "2026-10-12", "Главное прошлой", "", Date.now(), kv);
    expect(entryDrafts("reva", "2026-10-12", Date.now(), kv).map((d) => d.input.what)).toEqual(["Прошлая"]);
    expect(entryDrafts("reva", "2026-10-19", Date.now(), kv).map((d) => d.input.what)).toEqual(["Отчётная"]);
    expect(headlineDraft("reva", "2026-10-12", Date.now(), kv)?.value).toBe("Главное прошлой");
    expect(headlineDraft("reva", "2026-10-19", Date.now(), kv)).toBeNull();
  });
});
