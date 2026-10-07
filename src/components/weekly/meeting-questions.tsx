"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { authorName, compactName } from "@/domain/people";
import type { MeetingQuestion } from "@/lib/discuss/service";
import type { StaleProposal } from "@/lib/requests/service";
import { currentDue, type RequestView } from "@/domain/requests";
import { formatShort } from "@/domain/dates";
import { RequestBadge } from "@/components/requests/request-parts";
import { setDiscussedAction } from "@/app/(app)/weekly/discuss-actions";
import { weekNumberOf } from "@/lib/weekly/weeks";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * Вопросы к встрече (этап 20): «Обсудить на встрече» к записям и комментариям. Необсуждённые сверху,
 * «Обсуждено» убирает вопрос из повестки. Прошлые недели показывают только то, что ещё не обсудили
 */
/** Что зависло (этап 21): просьбы без ответа больше 2 рабочих дней и просроченные принятые, предложения без ответа 3 дня */
export type StuckItems = { requests: RequestView[]; proposals: StaleProposal[] };

export function MeetingQuestions({ week, questions, stuck = { requests: [], proposals: [] } }: { week: number; questions: MeetingQuestion[]; stuck?: StuckItems }) {
  const { notify, observer } = usePrototype();
  const [list, setList] = useState(questions);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => setList(questions), [questions]);
  const open = list.filter((q) => !q.discussed).length;
  const mark = async (q: MeetingQuestion) => {
    setBusy(q.id);
    try {
      const r = await setDiscussedAction(q.id, !q.discussed);
      if (!r.ok) notify(r.error, "error");
      else setList((all) => all.map((x) => (x.id === q.id ? { ...x, discussed: r.value.discussed } : x)));
    } catch {
      notify("Нет связи с сервером: отметка не сохранилась", "error");
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <h1 className="text-display-sm font-semibold leading-tight text-ink sm:text-display">Вопросы к встрече</h1>
      <p className="mt-2 text-title text-muted">
        Неделя {week}. {open ? `Не обсудили: ${open}` : "Все вопросы обсудили"}
      </p>
      <ul className="mt-8 flex flex-col gap-4">
        {list.map((q) => (
          <li key={q.id} className={cn("flex flex-col gap-3 rounded-xl px-5 py-4 ring-1 sm:flex-row sm:items-start sm:justify-between", q.discussed ? "bg-surface ring-line" : "bg-white ring-warning/40")}>
            <div className="min-w-0">
              <p className={cn("flex items-start gap-2 text-title font-semibold leading-snug", q.discussed ? "text-muted" : "text-ink")}>
                <MessagesSquare className="mt-1 h-5 w-5 shrink-0" aria-hidden="true" />
                {q.question}
              </p>
              <p className="mt-1 text-body text-muted">
                Спрашивает {compactName(q.by)}
                {q.entry ? (
                  <>
                    {" "}
                    к записи{" "}
                    <Link href={`/weekly/entry/${q.entry.id}`} className="font-medium text-blue-700 hover:underline">
                      «{q.entry.what}»
                    </Link>
                    , {authorName(q.entry.author, "compact", "общая запись")}
                  </>
                ) : q.task ? (
                  <>
                    {" "}
                    к задаче{" "}
                    <Link href={`/tasks/${q.task.number}`} className="font-medium text-blue-700 hover:underline">
                      {q.task.number} {q.task.title}
                    </Link>
                  </>
                ) : null}
                {q.week ? `. С недели ${weekNumberOf(q.week)}` : ""}
              </p>
            </div>
            {observer ? null : (
              <Button size="sm" variant={q.discussed ? "ghost" : "secondary"} disabled={busy !== null} onClick={() => void mark(q)}>
                {q.discussed ? "Вернуть в повестку" : "Обсуждено"}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {stuck.requests.length || stuck.proposals.length ? (
        <section aria-labelledby="meeting-stuck" className="mt-10">
          <h2 id="meeting-stuck" className="text-title-lg font-semibold text-ink">
            Зависло: {stuck.requests.length + stuck.proposals.length}
          </h2>
          <p className="mt-1 text-body text-muted">Просьбы без ответа больше 2 рабочих дней, принятые с прошедшим сроком и предложенные задачи без ответа 3 дня. Уходят отсюда, когда на них ответят.</p>
          <ul className="mt-5 flex flex-col gap-3">
            {stuck.requests.map((r) => (
              <li key={`r${r.number}`} className="rounded-xl bg-white px-5 py-4 ring-1 ring-line">
                <Link href={`/requests/${r.number}`} className="text-title font-semibold leading-snug text-ink hover:text-blue-700 hover:underline">
                  Просьба {r.number}: {r.text}
                </Link>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-body text-muted">
                  <RequestBadge status={r.status} />
                  {compactName(r.author)} просит {compactName(r.addressee)}, срок {formatShort(currentDue(r))}
                </p>
              </li>
            ))}
            {stuck.proposals.map((p) => (
              <li key={`p${p.number}`} className="rounded-xl bg-white px-5 py-4 ring-1 ring-line">
                <Link href={`/tasks/${p.number}`} className="text-title font-semibold leading-snug text-ink hover:text-blue-700 hover:underline">
                  Предложена задача {p.number}: {p.title}
                </Link>
                <p className="mt-1 text-body text-muted">
                  Предложение{p.createdBy ? ` от ${compactName(p.createdBy)}` : ""}{p.owner ? ` для ${compactName(p.owner)}` : ""}, без ответа {p.days} дн.
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
