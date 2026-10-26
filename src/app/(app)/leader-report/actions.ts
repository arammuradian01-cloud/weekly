"use server";

// Действия раздела «Отчёт руководителю» (этап 73): комментарии получателя к отправленному отчёту и ответы автора.
// Права и правила проверяет сервис.

import { runAction, type Result } from "@/lib/action-runner";
import type { WeekKey } from "@/domain/types";
import { addReportComment, type SentReportView } from "@/lib/leader-report/service";

export type CommentPayload = { text: string; parentId?: string | null; blockKey?: string | null; lineText?: string | null };

export async function addReportCommentAction(teamId: string, week: WeekKey, payload: CommentPayload): Promise<Result<SentReportView | null>> {
  return runAction("Комментарий к отчёту руководителю", (a) =>
    addReportComment(a, {
      teamId: String(teamId),
      week,
      text: String(payload?.text ?? ""),
      parentId: payload?.parentId ? String(payload.parentId) : null,
      blockKey: payload?.blockKey ? String(payload.blockKey) : null,
      lineText: typeof payload?.lineText === "string" ? payload.lineText : null,
    }),
  );
}
