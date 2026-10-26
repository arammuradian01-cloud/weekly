"use client";

// Отправленный отчёт руководителю с комментариями (этап 73). Ровно то, что ушло получателю: блоки отправленной версии,
// у отчёта команды страхования и инвестиций ещё решения, благодарности и встречи недели. Получатель пишет комментарий к
// отчёту целиком и к отдельной строке, автор и получатель отвечают в ветке. Комментарии видят только автор, получатель
// и владельцы. Один экран и в «Отправленных» (глазами автора), и в «Полученных» (глазами получателя).

import { useState } from "react";
import { MessageSquare, MessageSquarePlus, Reply } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { WeekKey } from "@/domain/types";
import type { ReportCommentView, SentReportView } from "@/lib/leader-report/service";
import { REPORT_COMMENT_MAX } from "@/lib/leader-report/rules";
import { moscowMoment } from "@/lib/weekly/rules";
import type { BlockLine } from "@/lib/weekly-blocks/types";
import { addReportCommentAction, type CommentPayload } from "@/app/(app)/leader-report/actions";
import { CeoAssembled } from "@/components/ceo/ceo-assembled";
import { BlocksView } from "@/components/weekly-blocks/blocks-view";
import { Button } from "@/components/ui/button";
import { TextArea } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";
import { cn } from "@/lib/cn";

type Target = { kind: "report" } | { kind: "line"; blockKey: string; lineText: string; key: string } | { kind: "reply"; parentId: string };

const targetKey = (t: Target | null) => (!t ? "" : t.kind === "report" ? "report" : t.kind === "line" ? `line:${t.key}` : `reply:${t.parentId}`);

export function SentReportScreen({ initial, mode }: { initial: SentReportView; mode: "sent" | "received" }) {
  const { notify } = usePrototype();
  const [view, setView] = useState(initial);
  const [target, setTarget] = useState<Target | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const comments = view.comments ?? [];
  const roots = comments.filter((c) => !c.parentId);
  const repliesOf = (id: string) => comments.filter((c) => c.parentId === id);
  const lineRoots = (blockKey: string, line: BlockLine) => roots.filter((c) => c.blockKey === blockKey && c.lineText === line.text);
  // К отчёту целиком и к строкам, которых не видно: строку убрали при повторной отправке или зритель не видит её цифры
  const reportRoots = roots.filter((c) => !c.blockKey || c.lineGone || c.lineHidden || !c.lineText);

  const open = (t: Target) => {
    setTarget(t);
    setText("");
    setError(null);
  };

  const submit = async () => {
    if (!target) return;
    const payload: CommentPayload =
      target.kind === "report" ? { text } : target.kind === "line" ? { text, blockKey: target.blockKey, lineText: target.lineText } : { text, parentId: target.parentId };
    setBusy(true);
    setError(null);
    try {
      const r = await addReportCommentAction(view.team.id, view.week as WeekKey, payload);
      if (!r.ok) return setError(r.error);
      if (r.value) setView(r.value);
      setTarget(null);
      setText("");
      notify(target.kind === "reply" ? "Ответ отправлен" : "Комментарий отправлен");
    } catch {
      setError("Нет связи с сервером: комментарий не отправлен");
    } finally {
      setBusy(false);
    }
  };

  const form = (t: Target, label: string) =>
    targetKey(target) === targetKey(t) ? (
      <div className="mt-2 flex flex-col gap-2" data-testid="report-comment-form">
        <TextArea
          label={label}
          id={`rc-${targetKey(t).replace(/[^a-z0-9-]/gi, "-")}`}
          value={text}
          rows={3}
          maxLength={REPORT_COMMENT_MAX}
          autoFocus
          onChange={(e) => setText(e.target.value)}
          counter={{ value: text.length, max: REPORT_COMMENT_MAX }}
        />
        <FormError message={error ?? undefined} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button size="sm" variant="secondary" onClick={() => setTarget(null)} disabled={busy}>
            Отмена
          </Button>
          <Button size="sm" onClick={() => void submit()} disabled={busy || !text.trim()} loading={busy}>
            Отправить
          </Button>
        </div>
      </div>
    ) : null;

  const thread = (c: ReportCommentView) => (
    <li key={c.id} className="flex flex-col gap-2 rounded-lg bg-field px-3 py-2.5" data-testid="report-comment">
      <Comment c={c} />
      {c.blockKey && (c.lineGone || c.lineHidden) ? (
        <p className="text-caption text-text-secondary">{c.lineHidden ? "К строке с цифрами, которые вам не видны" : `К строке, которой больше нет в отчёте: «${c.lineText ?? ""}»`}</p>
      ) : null}
      {repliesOf(c.id).length ? (
        <ul className="m-0 flex list-none flex-col gap-2 border-l-2 border-line pl-3">
          {repliesOf(c.id).map((r) => (
            <li key={r.id} data-testid="report-reply">
              <Comment c={r} />
            </li>
          ))}
        </ul>
      ) : null}
      {view.canReply ? (
        <>
          {targetKey(target) !== `reply:${c.id}` ? (
            <div>
              <Button size="sm" variant="ghost" onClick={() => open({ kind: "reply", parentId: c.id })} aria-label={`Ответить на комментарий: ${c.author}`}>
                <Reply className="h-4 w-4" aria-hidden="true" />
                Ответить
              </Button>
            </div>
          ) : null}
          {form({ kind: "reply", parentId: c.id }, "Ответ")}
        </>
      ) : null}
    </li>
  );

  const lineAside = view.comments === null && !view.canStart
    ? undefined
    : (blockKey: string, line: BlockLine, index: number) => {
        const list = lineRoots(blockKey, line);
        const t: Target = { kind: "line", blockKey, lineText: line.text, key: `${blockKey}-${index}` };
        if (!list.length && !view.canStart) return null;
        return (
          <div className="mt-1 flex flex-col gap-2">
            {list.length ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{list.map(thread)}</ul> : null}
            {view.canStart && targetKey(target) !== targetKey(t) ? (
              <div>
                <button
                  type="button"
                  onClick={() => open(t)}
                  className="inline-flex min-h-11 items-center gap-1 text-small font-medium text-link hover:underline sm:min-h-8"
                  aria-label={`Комментировать строку: ${line.text.slice(0, 80)}`}
                >
                  <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                  Комментировать строку
                </button>
              </div>
            ) : null}
            {view.canStart ? form(t, "Комментарий к строке") : null}
          </div>
        );
      };

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="sent-report">
      <div>
        <h2 className="text-title font-semibold text-ink">
          Отчёт за неделю {view.number}, команда «{view.team.name}»
        </h2>
        <p className="mt-1 text-body text-muted" data-testid="sent-report-meta">
          Отправлен {moscowMoment(view.sentAt)}
          {view.sentBy ? `, отправил ${view.sentBy}` : ""}
          {view.to.length ? `. Получил: ${view.to.join(", ")}` : ""}
        </p>
        {view.editedAfter ? (
          <p className="mt-2 sv-alert sv-alert--info text-small" data-testid="sent-report-edited">
            {mode === "sent" ? "После отправки черновик правили: здесь отправленная версия. Чтобы получатель увидел правки, отправьте отчёт ещё раз." : "После отправки автор правил отчёт: здесь отправленная вам версия."}
          </p>
        ) : null}
      </div>
      <article className="sv-card sv-card--soft px-4 py-4 sm:px-5" data-testid="sent-report-body">
        {view.live ? (
          <CeoAssembled ctx={view.live} sections={view.sections} blocks={view.blocks} labels={view.labels} order={view.order} meetings={view.meetings} idPrefix="lr-sent" lineAside={lineAside} />
        ) : (
          <BlocksView blocks={view.blocks ?? []} labels={view.labels} order={view.order} idPrefix="lr-sent" lineAside={lineAside} />
        )}
      </article>
      {view.comments !== null || view.canStart ? (
        <section aria-labelledby="report-comments" className="flex flex-col gap-3" data-testid="report-comments">
          <h3 id="report-comments" className="inline-flex items-center gap-2 text-title-sm font-semibold text-ink">
            <MessageSquare className="h-5 w-5" aria-hidden="true" />
            Комментарии руководителя <span className="font-normal text-muted">{comments.length}</span>
          </h3>
          <p className="text-small text-muted">Видят только автор отчёта, получатель и владельцы ресурса. Участники команды комментарии не видят.</p>
          {reportRoots.length ? <ul className="m-0 flex list-none flex-col gap-2 p-0">{reportRoots.map(thread)}</ul> : !comments.length ? <p className="text-body text-muted">{view.canStart ? "Комментариев пока нет. Напишите к отчёту целиком или к строке." : "Комментариев пока нет."}</p> : null}
          {view.canStart ? (
            targetKey(target) === "report" ? (
              form({ kind: "report" }, "Комментарий к отчёту")
            ) : (
              <div>
                <Button variant="secondary" size="sm" onClick={() => open({ kind: "report" })}>
                  <MessageSquarePlus className="h-4 w-4" aria-hidden="true" />
                  Комментарий к отчёту
                </Button>
              </div>
            )
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

function Comment({ c }: { c: ReportCommentView }) {
  return (
    <div className="min-w-0">
      <p className="text-caption text-text-secondary">
        <span className={cn("font-semibold", c.side === "recipient" ? "text-ink" : "text-ink")}>{c.author}</span>
        {c.side === "recipient" ? ", руководитель" : ", автор отчёта"}, {moscowMoment(c.at)}
      </p>
      <p className="whitespace-pre-wrap break-words text-body text-ink">{c.text}</p>
    </div>
  );
}
