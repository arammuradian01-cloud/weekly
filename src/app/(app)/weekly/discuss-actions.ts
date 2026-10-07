"use server";

// Обсуждение записей weekly из экранов (этап 20): комментарии, реакции, вопросы к встрече.
// Права проверяет сервис: экран лишь прячет то, что нельзя.

import { runAction, type Result } from "@/lib/action-runner";
import * as svc from "@/lib/discuss/service";

export async function addEntryCommentAction(entryId: string, text: string): Promise<Result<svc.CommentResult>> {
  return runAction("Комментарий к записи", (a) => svc.addEntryComment(a, String(entryId), String(text ?? "")));
}

export async function editEntryCommentAction(commentId: string, text: string): Promise<Result<svc.CommentResult>> {
  return runAction("Правка комментария", (a) => svc.editEntryComment(a, String(commentId), String(text ?? "")));
}

export async function deleteEntryCommentAction(commentId: string): Promise<Result<svc.CommentResult>> {
  return runAction("Удаление комментария", (a) => svc.deleteEntryComment(a, String(commentId)));
}

export async function reactEntryAction(target: { entryId?: string; entryCommentId?: string }, kind: string, question?: string | null): Promise<Result<svc.ReactionResult>> {
  return runAction("Реакция", (a) =>
    svc.reactToEntry(
      a,
      target?.entryCommentId ? { entryCommentId: String(target.entryCommentId) } : { entryId: String(target?.entryId ?? "") },
      kind,
      question == null ? null : String(question),
    ),
  );
}

export async function setDiscussedAction(reactionId: string, discussed: boolean): Promise<Result<{ discussed: boolean }>> {
  return runAction("Обсуждено", (a) => svc.setDiscussed(a, String(reactionId), discussed === true));
}
