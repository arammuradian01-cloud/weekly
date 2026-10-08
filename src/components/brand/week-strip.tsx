import { cn } from "@/lib/cn";

/**
 * Неделя рядом ячеек: ритм команды на экране входа и в образце компонентов.
 * Ячейки дней сжимаются под ширину экрана, поэтому ряд не вылезает за край даже на 360 пикселях.
 */

export type StripDay = {
  key: string;
  weekday: string;
  /** Число месяца, если нужно */
  date?: number;
  state?: "past" | "today" | "future";
};

export function WeekStrip({
  days,
  deadline,
  meeting,
  tone = "light",
  size = "md",
  className,
}: {
  days: StripDay[];
  /** Ячейка срока сдачи после недели */
  deadline?: { weekday: string; date?: number; time: string };
  /** Ячейка встречи после срока, показывается от планшета и шире */
  meeting?: { label: string };
  tone?: "light" | "dark";
  size?: "md" | "lg";
  className?: string;
}) {
  const dark = tone === "dark";
  void size;
  // По дизайн-системе (weekly/WeekDays.jsx): семь скруглённых ячеек дней, сегодня голубая, выходные красным словом;
  // справа две ячейки срока weekly и встречи. Параллелограммы система убрала
  return (
    <div className={cn("flex w-full flex-col gap-2", className)} aria-hidden="true">
      <div className="sv-days">
        {days.map((d, i) => (
          <div
            key={d.key}
            className={cn(
              "sv-day",
              d.state === "today" && "is-today",
              d.state === "past" && "is-past",
              i >= 5 && "is-weekend",
              dark && d.state !== "today" && "!border-white/15 !bg-white/5 text-white",
            )}
          >
            <span className={cn("sv-day__wd", dark && d.state !== "today" && "!text-white/70")}>{d.weekday.toLowerCase()}</span>
            {d.date !== undefined ? <span className="sv-day__n">{d.date}</span> : null}
          </div>
        ))}
      </div>
      {deadline || meeting ? (
        <div className="sv-days-events">
          {deadline ? (
            <div className={cn("sv-days-event", dark && "!border-white/15 !bg-white/5 text-white/85")}>
              <span className="sv-day__mark sv-day__mark--deadline !mt-0">срок</span>
              <span>
                <b className={dark ? "!text-white" : undefined}>
                  {deadline.weekday.toLowerCase()}
                  {deadline.date !== undefined ? ` ${deadline.date}` : ""}, {deadline.time}
                </b>
                : weekly
              </span>
            </div>
          ) : null}
          {meeting ? (
            <div className={cn("sv-days-event", dark && "!border-white/15 !bg-white/5 text-white/85")}>
              <span className="sv-day__mark sv-day__mark--meeting !mt-0">встреча</span>
              <b className={dark ? "!text-white" : undefined}>{meeting.label}</b>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
