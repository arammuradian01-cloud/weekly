// Собранный отчёт CEO только для чтения (этап 61): цифры недели, итог прогноза месяца, главное, решения недели, риски,
// что дальше, благодарности и «Мои встречи недели». Так CEO видит отправленный weekly, и так выглядит предпросмотр на
// вкладке «Weekly для CEO» в разборе встречи. Без состояния: подходит и серверу, и клиенту.

import type { CeoContext } from "@/lib/ceo/assembled";
import type { CeoSections } from "@/lib/weekly/rules";
import type { CeoMeeting } from "@/lib/ceo/text";
import { WeekNumbersBlock } from "@/components/forecast/week-numbers";
import { PlanBriefBlock } from "@/components/plan/plan-brief";
import { cn } from "@/lib/cn";

function Part({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <h3 id={id} className="text-title-sm font-semibold text-ink">
        {title}
      </h3>
      <div className="mt-2 text-body text-ink">{children}</div>
    </section>
  );
}

const text = (value: string) => (value.trim() ? <p className="whitespace-pre-wrap break-words">{value.trim()}</p> : <p className="text-muted">Раздел пустой</p>);

export function CeoAssembled({ ctx, sections, meetings, idPrefix = "ceo", className }: { ctx: CeoContext; sections: CeoSections; meetings: CeoMeeting[]; idPrefix?: string; className?: string }) {
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <div className={cn("flex min-w-0 flex-col gap-5", className)} data-testid={`${idPrefix}-assembled`}>
      {ctx.numbers ? <WeekNumbersBlock numbers={ctx.numbers} compact headingLevel="h3" /> : null}
      {ctx.plan ? <PlanBriefBlock brief={ctx.plan} compact headingLevel={3} /> : null}
      <Part id={id("main")} title="Главное за неделю">
        {text(sections.main)}
      </Part>
      {ctx.decisions.length ? (
        <Part id={id("decisions")} title="Решения недели">
          <ul className="flex list-disc flex-col gap-1 pl-5">
            {ctx.decisions.map((d) => (
              <li key={d.id} className="break-words">
                {d.text}
                {d.owner ? <span className="text-muted">. Владелец: {d.owner}</span> : null}
              </li>
            ))}
          </ul>
        </Part>
      ) : null}
      <Part id={id("risks")} title="Риски">
        {text(sections.risks)}
      </Part>
      <Part id={id("next")} title="Что дальше">
        {text(sections.next)}
      </Part>
      {ctx.thanks.length ? (
        <Part id={id("thanks")} title="Благодарности">
          <ul className="flex flex-col gap-1">
            {ctx.thanks.map((t, i) => (
              <li key={i} className="break-words">
                <span className="font-medium">{t.name}:</span> {t.text}
              </li>
            ))}
          </ul>
        </Part>
      ) : null}
      {meetings.length ? (
        <Part id={id("meetings")} title="Мои встречи недели">
          <div className="flex flex-col gap-3">
            {meetings.map((m, i) => (
              <div key={i}>
                <p className="font-medium">{m.title || "Встреча"}</p>
                <p className="whitespace-pre-wrap break-words">{m.text}</p>
              </div>
            ))}
          </div>
        </Part>
      ) : null}
    </div>
  );
}
