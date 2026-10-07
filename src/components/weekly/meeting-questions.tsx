"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { MessagesSquare } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { authorName, compactName } from "@/domain/people";
import type { MeetingQuestion } from "@/lib/discuss/service";
import { setDiscussedAction } from "@/app/(app)/weekly/discuss-actions";
import { weekNumberOf } from "@/lib/weekly/weeks";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";

/**
 * Вопросы к встрече (этап 20): «Обсудить на встрече» к записям и комментариям. Необсуждённые сверху,
 * «Обсуждено» убирает вопрос из повестки. Прошлые недели показывают только то, что ещё не обсудили
 */
export function MeetingQuestions({ week, questions }: { week: number; questions: MeetingQuestion[] }) {
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
    </>
  );
}
