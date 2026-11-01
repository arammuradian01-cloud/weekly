"use client";

// Обсуждение отправленного отчёта (этап 73+81): замечание получателя к отчёту целиком или к строке блока и ответы в
// ветке. Форма видна тому, кому её показал сервер; отказ всё равно даёт сервер.
//
// Без эффектов: состояние только от нажатий, поэтому setState в useEffect здесь нет и не нужно.

import { useState } from "react";
import { MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SelectField, TextArea } from "@/components/ui/primitives";
import { useRunWeekly } from "@/components/weekly/use-weekly";
import { addReportCommentAction } from "@/app/(app)/leader-report/actions";
import { REPORT_COMMENT_MAX } from "@/lib/leader-report/rules";
import type { ReportComment, ReportCommentsView } from "@/lib/leader-report/comments";
import type { ReportBlock } from "@/lib/weekly-blocks/types";

const moment = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)).replace(" в ", ", ");

/** Выбор места комментария: отчёт целиком или одна строка видимого блока */
const WHOLE = "whole";
const placeValue = (blockKey: string, index: number) => `${blockKey}#${index}`;

function places(blocks: readonly ReportBlock[]) {
  const out = [{ value: WHOLE, label: "К отчёту целиком" }];
  for (const b of blocks) {
    b.lines.forEach((line, index) => {
      const text = line.text.length > 70 ? `${line.text.slice(0, 69)}…` : line.text;
      out.push({ value: placeValue(b.key, index), label: `${b.title}: ${text}` });
    });
  }
  return out;
}

function Reply({ reply }: { reply: { author: string; mine: boolean; at: string; text: string } }) {
  return (
    <li className="min-w-0 border-l-2 border-line pl-3">
      <p className="text-caption text-muted">
        {reply.mine ? "Вы" : reply.author}, {moment(reply.at)}
      </p>
      <p className="whitespace-pre-wrap break-words text-body text-ink">{reply.text}</p>
    </li>
  );
}

export function ReportComments({
  teamId,
  week,
  teamName,
  blocks,
  initial,
}: {
  teamId: string;
  week: string;
  teamName: string;
  blocks: readonly ReportBlock[];
  initial: ReportCommentsView;
}) {
  const run = useRunWeekly();
  const [view, setView] = useState(initial);
  const [place, setPlace] = useState(WHOLE);
  const [text, setText] = useState("");
  /** id ветки, в которой открыта форма ответа, и текст ответа */
  const [reply, setReply] = useState<{ id: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const send = async (input: { parentId?: string; blockKey?: string; lineIndex?: number }, value: string, after: () => void) => {
    if (!value.trim()) return;
    setBusy(true);
    const result = await run(() => addReportCommentAction({ teamId, week, ...input }, value), "Комментарий отправлен");
    setBusy(false);
    if (result) {
      setView(result);
      after();
    }
  };

  const onSend = () => {
    const [blockKey, index] = place === WHOLE ? [undefined, undefined] : place.split("#");
    void send(blockKey ? { blockKey, lineIndex: Number(index) } : {}, text, () => {
      setText("");
      setPlace(WHOLE);
    });
  };

  const options = places(blocks);
  const id = `report-comment-${teamId}-${week}`;
  if (!view.access.sees) return null;
  return (
    <section aria-label={`Обсуждение отчёта команды «${teamName}»`} className="flex min-w-0 flex-col gap-3" data-testid="report-comments">
      <h4 className="inline-flex items-center gap-2 text-body font-semibold text-ink">
        <MessageSquare className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
        Обсуждение с руководителем{view.comments.length ? `: ${view.comments.length}` : ""}
      </h4>
      {view.comments.length ? (
        <ul className="m-0 flex list-none flex-col gap-4 p-0">
          {view.comments.map((c: ReportComment) => (
            <li key={c.id} className="sv-card sv-card--soft min-w-0 p-4" data-testid="report-comment">
              {c.blockKey && c.lineText ? (
                <p className="mb-2 break-words border-l-2 border-accent-line pl-3 text-small text-muted">
                  {c.lineText}
                  {!c.linePresent ? " (этой строки в отчёте больше нет)" : ""}
                </p>
              ) : null}
              <p className="text-caption text-muted">
                {c.mine ? "Вы" : c.author}, {moment(c.at)}
              </p>
              <p className="whitespace-pre-wrap break-words text-body text-ink">{c.text}</p>
              {c.replies.length ? (
                <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
                  {c.replies.map((r) => (
                    <Reply key={r.id} reply={r} />
                  ))}
                </ul>
              ) : null}
              {view.access.canReply ? (
                reply && reply.id === c.id ? (
                  <div className="mt-3 flex min-w-0 flex-col gap-2">
                    <TextArea
                      id={`${id}-reply-${c.id}`}
                      label="Ответ"
                      rows={3}
                      value={reply.text}
                      onChange={(e) => setReply({ id: c.id, text: e.target.value })}
                      counter={{ value: reply.text.length, max: REPORT_COMMENT_MAX }}
                    />
                    <div className="flex flex-col-reverse gap-2 sm:flex-row">
                      <Button variant="secondary" size="sm" onClick={() => setReply(null)}>
                        Не отвечать
                      </Button>
                      <Button size="sm" disabled={busy || !reply.text.trim()} onClick={() => void send({ parentId: c.id }, reply.text, () => setReply(null))}>
                        Ответить
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="ghost" size="sm" className="mt-2" onClick={() => setReply({ id: c.id, text: "" })}>
                    Ответить
                  </Button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-small text-muted">
          {view.access.canStart
            ? "Комментариев пока нет. Напишите, что поправить или о чём спросить: автор отчёта увидит это на «Моей неделе»."
            : "Комментариев от руководителя пока нет."}
        </p>
      )}
      {view.access.canStart ? (
        <div className="flex min-w-0 flex-col gap-2">
          <SelectField
            id={`${id}-place`}
            label="К чему комментарий"
            value={place}
            options={options}
            onChange={(e) => setPlace(e.target.value)}
            hint={options.length > 1 ? "Можно к отчёту целиком или к одной строке" : undefined}
          />
          <TextArea
            id={`${id}-text`}
            label="Комментарий руководителя"
            rows={3}
            value={text}
            onChange={(e) => setText(e.target.value)}
            counter={{ value: text.length, max: REPORT_COMMENT_MAX }}
          />
          <div>
            <Button disabled={busy || !text.trim() || text.length > REPORT_COMMENT_MAX} onClick={onSend}>
              Отправить комментарий
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
