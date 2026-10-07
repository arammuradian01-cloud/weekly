// Личная статистика «обещал и сделал» (этап 22, модуль М6): последние 8 законченных недель. Видна только самому
// человеку на «Моей неделе» и директору в отчёте CEO. Включается после 6 недель с обещаниями, рейтинга нет.

import type { PromiseHistory } from "@/lib/weekly/promise-service";
import { promiseShare, summaryText } from "@/lib/weekly/promises";

export function PromiseStats({ stats }: { stats: PromiseHistory }) {
  if (!stats.active) return null;
  const share = promiseShare(stats.total);
  return (
    <section aria-labelledby="promise-stats" className="rounded-xl px-5 py-4 ring-1 ring-line">
      <h2 id="promise-stats" className="text-title-sm font-semibold text-ink">
        Обещания и итоги
      </h2>
      {!stats.enabled ? (
        <p className="mt-1 text-body text-muted">
          Статистика появится, когда наберётся 6 недель с обещаниями. Сейчас недель: {stats.active}.
        </p>
      ) : (
        <>
          <p className="mt-1 text-body text-ink">
            За 8 недель сделано {share ?? 0}% обещаний. {summaryText(stats.total)}.
          </p>
          <ol className="mt-4 flex h-24 items-end gap-2" aria-label="Доля сделанного по неделям">
            {stats.weeks.map((w) => {
              const s = promiseShare(w.summary);
              return (
                <li key={w.key} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-caption tabular-nums text-muted">{s === null ? "" : `${s}%`}</span>
                  <span
                    className={s === null ? "w-full rounded-t bg-line" : "w-full rounded-t bg-green"}
                    style={{ height: `${s === null ? 2 : Math.max(4, Math.round((s / 100) * 56))}px` }}
                    aria-hidden="true"
                  />
                  <span className="text-caption tabular-nums text-muted">
                    <span className="sr-only">Неделя </span>
                    {w.number}
                    <span className="sr-only">: {s === null ? "обещаний не было" : `сделано ${s}%`}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-caption text-muted">Видите только вы и директор. Это подсказка для себя, а не рейтинг.</p>
        </>
      )}
    </section>
  );
}
