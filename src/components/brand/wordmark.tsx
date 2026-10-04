import { cn } from "@/lib/cn";

/** Название ресурса. Логотип Сравни подставим, когда Арам пришлёт файл с правом использования */
export function Wordmark({ tone = "dark", compact = false }: { tone?: "dark" | "light"; compact?: boolean }) {
  const onDark = tone === "dark";
  return (
    <div className="flex items-center gap-2.5">
      <svg viewBox="0 0 32 32" className="h-8 w-8 shrink-0" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill={onDark ? "rgba(255,255,255,0.08)" : "#002a3a"} />
        <path d="M11 8h13l-3 16H8z" fill="#0dd149" />
      </svg>
      <div className="leading-tight">
        <div className={cn("text-[17px] font-semibold", onDark ? "text-white" : "text-ink")}>Weekly</div>
        {!compact ? (
          <div className={cn("text-[12px]", onDark ? "text-white/60" : "text-muted")}>Страхование и инвестиции</div>
        ) : null}
      </div>
    </div>
  );
}
