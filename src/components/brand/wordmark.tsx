import { cn } from "@/lib/cn";

/**
 * Логотип Сравни из брендбука (public/logo, знак встроен из официального PNG). Не перерисовываем.
 * На тёмном меню белое слово с цветным знаком, на светлой шапке тёмно-синее слово (в тёмной теме белое).
 */
function Logo({ onDark, className }: { onDark: boolean; className?: string }) {
  if (onDark) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo/sravni_logo_rus_w.svg" alt="Сравни" className={cn("sv-logo w-auto shrink-0", className)} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo/sravni_logo_rus.svg" alt="Сравни" className={cn("sv-logo w-auto shrink-0 dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo/sravni_logo_rus_w.svg" alt="" aria-hidden="true" className={cn("hidden w-auto shrink-0 dark:block", className)} />
    </>
  );
}

/** Только знак: для меню иконками (1024-1259) */
export function Sign({ className }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/logo/sravni_sign.svg" alt="Сравни" className={cn("h-[26px] w-auto shrink-0", className)} />;
}

/** Логоблок бокового меню по дизайн-системе: логотип, черта, «Weekly» и подпись департамента */
export function SidebarBrand() {
  return (
    <div className="sv-sidebar__brand">
      <Logo onDark className="h-5" />
      <span className="sv-sidebar__sign">
        <Sign />
      </span>
      <span className="sv-sidebar__divider" />
      <div className="sv-sidebar__title">Weekly</div>
      <div className="sv-sidebar__sub">Страхование и инвестиции</div>
    </div>
  );
}

export function Wordmark({ tone = "dark", compact = false }: { tone?: "dark" | "light"; compact?: boolean }) {
  const onDark = tone === "dark";
  if (compact) {
    return (
      <div className="flex items-center gap-2.5">
        <Logo onDark={onDark} className="h-5" />
        <span className={cn("font-heading text-card font-bold", onDark ? "text-sidebar-text" : "text-ink")}>Weekly</span>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <Logo onDark={onDark} className="h-6 self-start" />
      <div className={cn("text-caption", onDark ? "text-sidebar-muted" : "text-muted")}>
        <span className={cn("font-heading text-small font-bold", onDark ? "text-sidebar-text" : "text-ink")}>Weekly</span> · Страхование и инвестиции
      </div>
    </div>
  );
}
