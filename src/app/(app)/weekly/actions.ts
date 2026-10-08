"use server";

// Действия weekly из экранов. Права и правила проверяет сервис.

import { unstable_rethrow } from "next/navigation";
import { requestIp, requireContext } from "@/lib/auth";
import { TaskRuleError, type Actor } from "@/lib/tasks/service";
import * as svc from "@/lib/weekly/service";
import { carryPromise, dropWeekSnapshot, reopenWeekly, reviewPromise, takeWeekSnapshot } from "@/lib/weekly/promise-service";
import { addFact, hideFact } from "@/lib/weekly/facts-service";
import type { EntryPromise } from "@/lib/weekly/promises";
import { issueEntryUndoToken, readEntryUndoToken } from "@/lib/weekly/undo";
import type { CeoSections } from "@/lib/weekly/rules";
import { audienceOf, currentTeam, subjectOf } from "@/lib/org/current";
import type { PersonSlug, PersonWeekly, WeekInfo, WeekKey, WeekView, WeeklyEntry } from "@/domain/types";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

async function actor(): Promise<Actor> {
  const ctx = await requireContext();
  return {
    personId: ctx.person.id,
    slug: ctx.person.slug as PersonSlug,
    fullName: ctx.person.fullName,
    role: ctx.person.role,
    management: ctx.management?.role ?? null,
    ip: await requestIp(),
    via: ctx.via,
  };
}

async function run<T>(fn: (a: Actor) => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn(await actor()) };
  } catch (error) {
    unstable_rethrow(error);
    if (error instanceof TaskRuleError) return { ok: false, error: error.message };
    console.error("Действие с weekly не прошло", error);
    return { ok: false, error: "Не получилось сохранить. Обновите страницу и попробуйте ещё раз" };
  }
}

/** expected: черновик с устройства (этап 26), на сервере должна быть эта фраза, иначе черновик устарел */
export async function saveHeadlineAction(week: WeekKey, headline: string, expected?: string): Promise<Result<PersonWeekly>> {
  return run((a) => svc.saveHeadline(a, week, String(headline ?? ""), typeof expected === "string" ? expected : undefined));
}

export async function saveEntryAction(input: svc.EntryInput): Promise<Result<WeeklyEntry>> {
  // Метку факта недели ставит только сервер (этап 22)
  return run((a) => svc.saveEntry(a, { ...input, factKey: undefined }));
}

/** Удалить запись. В ответе токен отмены: он живёт минуту, кнопка «Отменить» на экране 5 секунд */
export async function deleteEntryAction(id: string): Promise<Result<{ undo: string }>> {
  return run(async (a) => {
    const snapshot = await svc.deleteEntry(a, String(id));
    return { undo: issueEntryUndoToken(snapshot, a.personId) };
  });
}

/** Вернуть удалённую запись по токену отмены */
export async function restoreEntryAction(token: string): Promise<Result<WeeklyEntry>> {
  return run(async (a) => {
    const snapshot = readEntryUndoToken(String(token ?? ""), a.personId);
    if (!snapshot) throw new TaskRuleError("Отменить уже нельзя: прошло больше минуты");
    return svc.restoreEntry(a, snapshot);
  });
}

export async function submitWeeklyAction(week: WeekKey): Promise<Result<PersonWeekly>> {
  return run((a) => svc.submitWeekly(a, week));
}

/** «Спасибо @коллега за…» в weekly (этап 22) */
export async function saveThanksAction(week: WeekKey, text: string): Promise<Result<{ thanks: string; warning?: string }>> {
  return run((a) => svc.saveThanks(a, week, String(text ?? "")));
}

/** Вернуть сданный weekly в черновик, пока неделя открыта (этап 22) */
export async function reopenWeeklyAction(week: WeekKey): Promise<Result<null>> {
  return run(async (a) => {
    await reopenWeekly(a, week);
    return null;
  });
}

/** Факт недели записью weekly (этап 22) */
export async function addFactAction(week: WeekKey, factKey: string): Promise<Result<WeeklyEntry>> {
  return run((a) => addFact(a, week, String(factKey)));
}

/** Скрыть факт недели: больше не предлагается (этап 22) */
export async function hideFactAction(week: WeekKey, factKey: string): Promise<Result<null>> {
  return run(async (a) => {
    await hideFact(a, week, String(factKey));
    return null;
  });
}

/** Итог обещания прошлой недели (этап 22) */
export async function reviewPromiseAction(entryId: string, result: string, note?: string | null): Promise<Result<EntryPromise>> {
  return run((a) => reviewPromise(a, String(entryId), String(result), note == null ? null : String(note)));
}

/** Невыполненное обещание в план этой недели (этап 22) */
export async function carryPromiseAction(entryId: string): Promise<Result<{ promise: EntryPromise; entry: WeeklyEntry }>> {
  return run((a) => carryPromise(a, String(entryId)));
}

export async function setCeoFlagAction(id: string, ceo: boolean): Promise<Result<WeeklyEntry>> {
  return run((a) => svc.setCeoFlag(a, String(id), !!ceo));
}

export async function assignEntryAuthorAction(id: string, slug: PersonSlug): Promise<Result<WeeklyEntry>> {
  return run((a) => svc.assignEntryAuthor(a, String(id), slug));
}

export async function setWeekClosedAction(week: WeekKey, closed: boolean): Promise<Result<WeekInfo>> {
  return run(async (a) => {
    const info = await svc.setWeekClosed(a, week, !!closed);
    // Снимок итогов обещаний (этап 22): не получился сейчас, сделается при первом открытии отчёта CEO
    try {
      if (closed) await takeWeekSnapshot(week);
      else await dropWeekSnapshot(week);
    } catch (error) {
      console.error("Снимок недели не сохранился", error);
    }
    return info;
  });
}

export async function saveCeoReportAction(week: WeekKey, sections: CeoSections): Promise<Result<svc.CeoReportView>> {
  return run((a) => svc.saveCeoReport(a, week, sections));
}

/** Неделя для режима встречи и ленты без перезагрузки страницы */
export async function weekViewAction(week: WeekKey | null): Promise<WeekView> {
  const ctx = await requireContext();
  const team = await currentTeam(subjectOf(ctx));
  return svc.getWeekView(week, new Date(), audienceOf(team));
}

// ---------- Weekly команд (этап 15) ----------

export async function promoteEntryAction(id: string, note?: string | null): Promise<Result<WeeklyEntry>> {
  return run((a) => svc.promoteEntry(a, String(id), note == null ? null : String(note)));
}

export async function unpromoteEntryAction(id: string, by?: PersonSlug): Promise<Result<WeeklyEntry>> {
  return run((a) => svc.unpromoteEntry(a, String(id), by));
}

export async function setTeamWeekClosedAction(team: string, week: WeekKey, closed: boolean): Promise<Result<{ closed: boolean }>> {
  return run((a) => svc.setTeamWeekClosed(a, String(team), week, closed));
}
