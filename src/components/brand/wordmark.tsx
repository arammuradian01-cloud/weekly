import { cn } from "@/lib/cn";

/**
 * Логотип Сравни из брендбука (этап 18): официальные файлы из design/ds-step-1/assets/logo, не перерисовываем.
 * На тёмном меню белая надпись с цветным знаком, на светлой шапке тёмно-синяя. Под логотипом имя ресурса
 */
/** Файл логотипа: белый на тёмном меню всегда, на светлой шапке цветной в светлой теме и белый в тёмной */
function Logo({ onDark, className }: { onDark: boolean; className?: string }) {
  if (onDark) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo/sravni_logo_rus_w.svg" alt="Сравни" className={cn("w-auto shrink-0", className)} />;
  }
  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo/sravni_logo_rus.svg" alt="Сравни" className={cn("w-auto shrink-0 dark:hidden", className)} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logo/sravni_logo_rus_w.svg" alt="" aria-hidden="true" className={cn("hidden w-auto shrink-0 dark:block", className)} />
    </>
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
