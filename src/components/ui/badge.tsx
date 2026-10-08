import { cn } from "@/lib/cn";

/** Цвет никогда не единственный носитель смысла: в метке всегда есть слово (раздел 7 ТЗ).
 *  Вид из дизайн-системы (sv-badge): подложка тона, текст тона, точка слева у статусов */
export type BadgeTone = "green" | "blue" | "yellow" | "red" | "gray" | "outline" | "navy" | "orange" | "info";

const tones: Record<BadgeTone, string> = {
  green: "sv-badge--success",
  blue: "sv-badge--accent",
  yellow: "sv-badge--warning",
  red: "sv-badge--danger",
  gray: "sv-badge--neutral",
  outline: "sv-badge--outline",
  navy: "sv-badge--brand",
  orange: "sv-badge--warning",
  info: "sv-badge--info",
};

export function Badge({
  tone = "gray",
  dot = false,
  half = false,
  size,
  children,
  className,
}: {
  tone?: BadgeTone;
  /** Точка тона слева: у статусов задач, weekly и просьб */
  dot?: boolean;
  /** Половинная точка: «Выполнена частично» */
  half?: boolean;
  size?: "lg";
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("sv-badge shrink-0", tones[tone], size === "lg" && "sv-badge--lg", className)}>
      {dot ? <span className={cn("sv-badge__dot", half && "sv-badge__dot--half")} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
