"use client";

import { useEffect, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { compactName, initials } from "@/domain/people";
import { formatShort } from "@/domain/dates";
import type { Comment, PersonSlug, ReactionCode } from "@/domain/types";
import { Avatar } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { MentionArea } from "./mention-area";
import { MentionText } from "./mention-text";
import { CommentReactions } from "./reactions";

/** Свой комментарий правят 15 минут (этап 20). Сервер проверяет то же самое */
const EDIT_WINDOW_MS = 15 * 60_000;

export function canEditComment(c: Comment, me: PersonSlug, now: number | null): boolean {
  return now !== null && c.author === me && !!c.moment && now - new Date(c.moment).getTime() <= EDIT_WINDOW_MS;
}

/** Текущее время после загрузки страницы, раз в полминуты: кнопка «Изменить» гаснет сама. На сервере null */
function useNow(): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const action = "inline-flex min-h-7 items-center gap-1 rounded-md px-1.5 text-caption font-medium text-muted hover:bg-surface hover:text-ink";

/** Комментарии: автор, время, пометка «изменено», упоминания, правка своего в первые 15 минут, удаление, реакции */
export function CommentList({
  idPrefix,
  comments,
  me,
  manage,
  readOnly,
  onEdit,
  onDelete,
  onReact,
}: {
  idPrefix: string;
  comments: Comment[];
  me: PersonSlug;
  manage: boolean;
  readOnly?: boolean;
  onEdit: (id: string, text: string) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
  onReact: (id: string, code: ReactionCode, question?: string | null) => Promise<boolean>;
}) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow();
  if (!comments.length) return null;
  return (
    <ol className="flex flex-col gap-4">
      {comments.map((c) => {
        const mine = c.author === me;
        const editable = !readOnly && canEditComment(c, me, now);
        return (
          <li key={c.id} className="flex gap-3">
            <Avatar text={initials(c.author)} size="sm" tone={mine ? "navy" : "light"} />
            <div className="min-w-0 flex-1">
              <p className="text-caption text-muted">
                <span className="font-semibold text-ink">{compactName(c.author)}</span> {formatShort(c.at)}, {c.time}
                {c.edited ? <span>, изменено</span> : null}
              </p>
              {editing?.id === c.id ? (
                <form
                  className="mt-1 flex flex-col gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    if (!editing.text.trim() || busy) return;
                    setBusy(true);
                    const ok = await onEdit(c.id, editing.text.trim());
                    setBusy(false);
                    if (ok) setEditing(null);
                  }}
                >
                  <MentionArea
                    id={`${idPrefix}-edit-${c.id}`}
                    label="Изменить комментарий"
                    value={editing.text}
                    onChange={(text) => setEditing({ id: c.id, text })}
                    maxLength={2000}
                    autoFocus
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" type="submit" variant="secondary" disabled={!editing.text.trim() || busy}>
                      Сохранить
                    </Button>
                    <Button size="sm" type="button" variant="ghost" onClick={() => setEditing(null)}>
                      Отмена
                    </Button>
                  </div>
                </form>
              ) : (
                <MentionText text={c.text} className="mt-0.5 whitespace-pre-line text-body leading-relaxed text-ink" />
              )}
              {editing?.id !== c.id ? (
                <div className="flex flex-wrap items-center gap-1">
                  <CommentReactions id={`${idPrefix}-${c.id}`} reactions={c.reactions ?? []} me={me} readOnly={readOnly} onToggle={(code, q) => onReact(c.id, code, q)} />
                  {editable ? (
                    <button type="button" className={action} onClick={() => setEditing({ id: c.id, text: c.text })} aria-label="Изменить комментарий">
                      <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                      Изменить
                    </button>
                  ) : null}
                  {!readOnly && (mine || manage) ? (
                    deleting === c.id ? (
                      <span className="inline-flex items-center gap-1 text-caption">
                        Удалить комментарий?
                        <button
                          type="button"
                          className={`${action} text-danger-ink`}
                          disabled={busy}
                          onClick={async () => {
                            setBusy(true);
                            await onDelete(c.id);
                            setBusy(false);
                            setDeleting(null);
                          }}
                        >
                          Удалить
                        </button>
                        <button type="button" className={action} onClick={() => setDeleting(null)}>
                          Нет
                        </button>
                      </span>
                    ) : (
                      <button type="button" className={action} onClick={() => setDeleting(c.id)} aria-label="Удалить комментарий">
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Удалить
                      </button>
                    )
                  ) : null}
                </div>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
