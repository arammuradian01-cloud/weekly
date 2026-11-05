"use server";

// Действия раздела «Отчёт руководителю» (этап 73+81). Права и правила проверяет сервис: экран прячет форму, но отказ
// даёт сервер.

import { runAction, type Result } from "@/lib/action-runner";
import { addReportComment, type AddCommentInput, type ReportCommentsView } from "@/lib/leader-report/comments";

export async function addReportCommentAction(input: AddCommentInput, text: string): Promise<Result<ReportCommentsView>> {
  return runAction("Комментарий к отчёту руководителю", (actor) =>
    addReportComment(
      actor,
      {
        teamId: String(input?.teamId ?? ""),
        week: String(input?.week ?? ""),
        parentId: input?.parentId ? String(input.parentId) : null,
        blockKey: input?.blockKey ? String(input.blockKey) : null,
        lineIndex: typeof input?.lineIndex === "number" ? input.lineIndex : null,
      },
      String(text ?? ""),
    ),
  );
}
