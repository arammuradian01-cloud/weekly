"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, MessageSquare } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { Comment, ReactionCode, ReactionView, WeeklyEntry } from "@/domain/types";
import { addEntryCommentAction, deleteEntryCommentAction, editEntryCommentAction, reactEntryAction, setDiscussedAction } from "@/app/(app)/weekly/discuss-actions";
import type { Result } from "@/lib/action-runner";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { CommentList } from "./comment-list";
import { MentionArea } from "./mention-area";
import { ReactionBar } from "./reactions";

/**
 * Обсуждение под записью weekly (этап 20): реакции и короткая ветка комментариев. Ветка свёрнута, пока в ней
 * ничего нет или пока её не откроют; на странице записи открыта сразу
 */
export function EntryDiscussion({ entry, large, open: openInitially }: { entry: WeeklyEntry; large?: boolean; open?: boolean }) {
  const { me, manage, observer, notify } = usePrototype();
  const router = useRouter();
  const [comments, setComments] = useState<Comment[]>(entry.comments ?? []);
  const [reactions, setReactions] = useState<ReactionView[]>(entry.reactions ?? []);
  const [open, setOpen] = useState(!!openInitially);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  // Сервер прислал свежую запись (живое обновление или переход): берём её обсуждение
  useEffect(() => setComments(entry.comments ?? []), [entry.comments]);
  useEffect(() => setReactions(entry.reactions ?? []), [entry.reactions]);

  const call = async <T,>(fn: () => Promise<Result<T>>): Promise<T | null> => {
    try {
      const r = await fn();
      if (!r.ok) {
        notify(r.error, "error");
        return null;
      }
      return r.value;
    } catch {
      notify("Нет связи с сервером: правка не сохранилась", "error");
      return null;
    }
  };

  const afterComment = (value: { comment: Comment | null; warning?: string } | null, ok: string): boolean => {
    if (!value) return false;
    notify(value.warning ?? ok, value.warning ? "error" : undefined);
    router.refresh();
    return true;
  };

  const send = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    const value = await call(() => addEntryCommentAction(entry.id, text.trim()));
    setSending(false);
    if (value?.comment) {
      setComments((list) => [...list, value.comment!]);
      setText("");
    }
    afterComment(value, "Комментарий добавлен");
  };

  const react = async (target: { entryId?: string; entryCommentId?: string }, code: ReactionCode, question?: string | null): Promise<boolean> => {
    const value = await call(() => reactEntryAction(target, code, question));
    if (!value) return false;
    if (target.entryCommentId) setComments((list) => list.map((c) => (c.id === target.entryCommentId ? { ...c, reactions: value.reactions } : c)));
    else setReactions(value.reactions);
    return true;
  };

  const count = comments.length;
  const readOnly = observer;
  // «Обсуждено» отмечает ведущий (режим управления), автор вопроса или автор записи. Руководителя проверит сервер
  const canMark = (r: ReactionView) => manage || r.by === me.slug || entry.author === me.slug;

  return (
    <div className={cn("mt-2 flex flex-col gap-3 border-t border-line/70 pt-2.5", large && "gap-4")}>
      <ReactionBar
        id={`entry-${entry.id}`}
        reactions={reactions}
        me={me.slug}
        readOnly={readOnly}
        large={large}
        compact={!large && !openInitially}
        onToggle={(code, q) => react({ entryId: entry.id }, code, q)}
        canMarkDiscussed={canMark}
        onDiscussed={async (id, discussed) => {
          const value = await call(() => setDiscussedAction(id, discussed));
          if (!value) return false;
          setReactions((list) => list.map((r) => (r.id === id ? { ...r, discussed: value.discussed } : r)));
          return true;
        }}
      />
      <div>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="inline-flex min-h-8 items-center gap-1.5 rounded-md text-small font-medium text-navy hover:underline"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          {count ? `Обсуждение: ${count}` : "Обсудить"}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} aria-hidden="true" />
        </button>
        {open ? (
          <div className="mt-3 flex flex-col gap-4">
            <CommentList
              idPrefix={`entry-${entry.id}`}
              comments={comments}
              me={me.slug}
              manage={manage}
              readOnly={readOnly}
              onEdit={async (id, value) => {
                const r = await call(() => editEntryCommentAction(id, value));
                if (r?.comment) setComments((list) => list.map((c) => (c.id === id ? r.comment! : c)));
                return afterComment(r, "Комментарий изменён");
              }}
              onDelete={async (id) => {
                const r = await call(() => deleteEntryCommentAction(id));
                if (r) setComments((list) => list.filter((c) => c.id !== id));
                return afterComment(r, "Комментарий удалён");
              }}
              onReact={(id, code, q) => react({ entryCommentId: id }, code, q)}
            />
            {readOnly ? null : (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void send();
                }}
              >
                <MentionArea
                  id={`entry-comment-${entry.id}`}
                  label="Комментарий к записи"
                  value={text}
                  onChange={setText}
                  maxLength={2000}
                  hint="Чтобы позвать коллегу, наберите @ и начало имени"
                  onSubmit={() => void send()}
                />
                <div>
                  <Button size="sm" type="submit" variant="secondary" disabled={!text.trim() || sending}>
                    <MessageSquare className="h-4 w-4" aria-hidden="true" />
                    Отправить
                  </Button>
                </div>
              </form>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
