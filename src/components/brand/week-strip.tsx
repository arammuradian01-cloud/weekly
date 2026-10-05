import { cn } from "@/lib/cn";

/**
 * Неделя как ряд параллелограммов: фирменный мотив Сравни, привязанный к ритму команды.
 * Используется только как декор и подсказка: на экране входа и в шапке «Моей недели».
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
  const height = size === "lg" ? "h-20 sm:h-28" : "h-16";

  return (
    <div className={cn("flex w-full items-stretch gap-1 px-2 sm:gap-2", height, className)} aria-hidden="true">
      {days.map((d) => (
        <div
          key={d.key}
          className={cn(
            "flex min-w-0 flex-1 -skew-x-12 flex-col justify-between rounded-md px-1 py-2 sm:px-1.5",
            size === "lg" ? "max-w-14" : "max-w-12",
            d.state === "today"
              ? "bg-blue text-navy"
              : dark
                ? "bg-white/8 text-white/80"
                : d.state === "past"
                  ? "bg-surface text-muted"
                  : "bg-white text-ink ring-1 ring-line",
          )}
        >
          <span className="skew-x-12 text-[12px] font-medium leading-none">{d.weekday}</span>
          {d.date !== undefined ? (
            <span className="skew-x-12 text-[17px] font-semibold leading-none tabular-nums sm:text-lg">{d.date}</span>
          ) : null}
        </div>
      ))}
      {deadline ? (
        <>
          <div className={cn("mx-0.5 w-px shrink-0 sm:mx-1", dark ? "bg-white/20" : "bg-line")} />
          <div
            className={cn(
              "flex shrink-0 -skew-x-12 flex-col justify-between rounded-md bg-green px-2 py-2 text-navy",
              size === "lg" ? "w-[4.5rem] sm:w-28" : "w-[4.5rem] sm:w-24",
            )}
          >
            <span className="skew-x-12 text-[12px] font-semibold leading-none">
              {deadline.weekday}
              {deadline.date !== undefined ? ` ${deadline.date}` : ""}
            </span>
            <span className="skew-x-12 text-[13px] font-semibold leading-tight">
              <span className="hidden sm:inline">weekly </span>до {deadline.time}
            </span>
          </div>
          {meeting ? (
            <div
              className={cn(
                "hidden shrink-0 -skew-x-12 flex-col justify-end rounded-md px-2 py-2 ring-1 sm:flex",
                dark ? "text-white ring-white/30" : "text-ink ring-navy/25",
                size === "lg" ? "w-24" : "w-20",
              )}
            >
              <span className="skew-x-12 text-[13px] font-semibold leading-tight">{meeting.label}</span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
