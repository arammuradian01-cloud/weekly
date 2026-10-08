// Итоги анонимной оценки встреч (этап 29) для руководителя и руководства: в аналитике команды под остальными блоками.
// Пока опрос идёт, видно только число ответов. После закрытия: средняя, сколько раз поставили каждую оценку и что
// предлагают убрать. Меньше трёх ответов: итога нет, чтобы автора нельзя было угадать.

import type { RatingMonthView, RatingResults } from "@/lib/meeting-rating/service";
import { RATING_MIN } from "@/lib/meeting-rating/rules";
import { plural } from "@/domain/dates";

const answers = (n: number) => `${n} ${plural(n, "ответ", "ответа", "ответов")}`;
const avg = (n: number) => n.toLocaleString("ru-RU", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function statusLine(m: RatingMonthView, raters: number): string {
  if (m.open) return `Опрос идёт до ${m.closesLabel}, ответили ${m.answered} из ${raters}. Итог появится после закрытия`;
  if (!m.answered) return "Ответов не было";
  if (!m.summary || m.summary.hidden) return `${answers(m.answered)}: итог показывается от ${RATING_MIN} ответов`;
  return `${avg(m.summary.average!)} из 5, ${answers(m.answered)}`;
}

function Distribution({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <ul className="mt-3 flex max-w-md flex-col gap-1.5" aria-label="Сколько раз поставили каждую оценку">
      {[5, 4, 3, 2, 1].map((score) => {
        const n = counts[score - 1];
        return (
          <li key={score} className="grid grid-cols-[1.5rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-small">
            <span className="text-muted">
              <span className="sr-only">Оценка </span>
              {score}
            </span>
            <span className="h-2 overflow-hidden rounded-r bg-transparent" aria-hidden="true">
              <span className="block h-full rounded-r" style={{ width: `${(n / max) * 100}%`, minWidth: n ? 4 : 0, background: "var(--color-chart-1)" }} />
            </span>
            <span className="text-ink tabular-nums">{answers(n)}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function RatingResultsPanel({ data }: { data: RatingResults }) {
  const any = data.months.some((m) => m.answered > 0 || m.open);
  return (
    <section aria-labelledby="an-rating" className="mt-8 flex flex-col gap-3">
      <div>
        <h2 id="an-rating" className="text-title font-semibold text-ink">
          Встречи глазами команды
        </h2>
        <p className="mt-1 text-small text-muted">
          Анонимная оценка раз в месяц: полезность от 1 до 5 и что убрать. Отвечают участники команды, кроме руководителя, сейчас их {data.raters}. Итог виден после
          закрытия опроса, если ответили хотя бы {RATING_MIN}.
        </p>
      </div>
      {data.raters < RATING_MIN ? (
        <p className="text-small text-warning-ink">В команде меньше {RATING_MIN} участников: итог не появится, чтобы ответ нельзя было угадать.</p>
      ) : null}
      {any ? (
        <ul className="flex flex-col gap-3">
          {data.months
            .filter((m) => m.open || m.answered > 0)
            .map((m) => (
              <li key={m.month} className="sv-card sv-card--soft px-5 py-4">
                <h3 className="text-body font-semibold text-ink first-letter:uppercase">{m.label}</h3>
                <p className="text-small text-muted">{statusLine(m, data.raters)}</p>
                {m.summary && !m.summary.hidden && m.summary.counts ? <Distribution counts={m.summary.counts} /> : null}
                {m.summary && !m.summary.hidden && m.summary.remove.length ? (
                  <div className="mt-3">
                    <p className="text-small font-medium text-ink">Что предлагают убрать</p>
                    <ul aria-label="Что предлагают убрать" className="mt-1 flex list-disc flex-col gap-1 pl-5 text-small text-ink [overflow-wrap:anywhere]">
                      {m.summary.remove.map((r, i) => (
                        <li key={`${i}-${r}`}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </li>
            ))}
        </ul>
      ) : (
        <p className="text-small text-muted">Ответов пока не было. Участники увидят напоминание на главной в конце месяца.</p>
      )}
    </section>
  );
}
