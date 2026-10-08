// Отправка черновиков weekly с устройства (этап 26). Работает из оболочки приложения на любой странице: при открытии
// ресурса, когда возвращается связь, и перед выходом. Черновики, открытые сейчас на экране, не трогает.

import { saveEntryAction, saveHeadlineAction } from "@/app/(app)/weekly/actions";
import type { PersonWeekly, WeekKey, WeeklyEntry } from "@/domain/types";
import { ACTIVE_DRAFTS, allEntryDrafts, allHeadlineDrafts, dropEntryDraft, dropHeadlineDraft, isNetworkError, settleEntryDraft, settleHeadlineDraft } from "./drafts";

/** Событие окна: черновик дошёл до сервера. Экран сдачи обновляет список без перезагрузки */
export const DRAFT_SENT = "weekly-draft-sent";
export type DraftSentDetail = { entry?: WeeklyEntry; headline?: PersonWeekly };

export type FlushResult = { sent: number; rejected: string[]; offline: boolean };

let running: Promise<FlushResult> | null = null;

function announce(detail: DraftSentDetail) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<DraftSentDetail>(DRAFT_SENT, { detail }));
}

async function flush(person: string): Promise<FlushResult> {
  const result: FlushResult = { sent: 0, rejected: [], offline: false };
  if (typeof navigator !== "undefined" && !navigator.onLine) return { ...result, offline: true };
  for (const d of allEntryDrafts(person).filter((x) => !ACTIVE_DRAFTS.has(x.key))) {
    const sentAt = Date.now();
    try {
      const r = await saveEntryAction({
        ...d.input,
        week: d.input.week as WeekKey,
        id: d.entryId ?? undefined,
        clientKey: d.entryId ? undefined : (d.clientKey ?? d.key),
        baseUpdatedAt: d.entryId ? (d.baseUpdatedAt ?? undefined) : undefined,
      });
      if (r.ok) {
        settleEntryDraft(person, d.key, r.value.id, sentAt);
        result.sent += 1;
        announce({ entry: r.value });
      } else {
        // Правило не пускает (неделя закрыта, запись удалили, изменили на другом устройстве): повтор не поможет
        dropEntryDraft(person, d.key);
        result.rejected.push(`«${d.input.what.slice(0, 60)}»: ${r.error}`);
      }
    } catch (error) {
      if (isNetworkError(error)) return { ...result, offline: true };
      // Сбой сервера: черновик остаётся и уйдёт в следующий раз
    }
  }
  for (const h of allHeadlineDrafts(person).filter((x) => !ACTIVE_DRAFTS.has(`headline:${x.week}`))) {
    try {
      const r = await saveHeadlineAction(h.week as WeekKey, h.value, h.base);
      if (r.ok) {
        settleHeadlineDraft(person, h.week, h.value);
        result.sent += 1;
        announce({ headline: r.value });
      } else {
        dropHeadlineDraft(person, h.week);
        result.rejected.push(`Главная фраза: ${r.error}`);
      }
    } catch (error) {
      if (isNetworkError(error)) return { ...result, offline: true };
    }
  }
  return result;
}

/** Отправить всё, что ждёт на устройстве. Два вызова подряд не отправляют дважды: второй ждёт первый */
export function flushOfflineDrafts(person: string): Promise<FlushResult> {
  running ??= flush(person).finally(() => {
    running = null;
  });
  return running;
}
