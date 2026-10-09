import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconCircle } from "@/components/ui/tile";

/**
 * Пустое состояние по дизайн-системе (system/EmptyState.jsx, sv-empty): иконка на тонированном круге, заголовок,
 * одна фраза и одно действие. В блоках страницы вид в строку (compact), на пустой странице по центру.
 * Иллюстрации бренд-команды встанут на место круга, когда будут файлы.
 */
export function EmptyState({
  title,
  children,
  stage,
  className,
  icon = Inbox,
  tone = "neutral",
  action,
  centered = false,
}: {
  title: string;
  children?: React.ReactNode;
  stage?: string;
  className?: string;
  icon?: LucideIcon;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger" | "info";
  action?: React.ReactNode;
  /** По центру с крупным кругом: пустая страница целиком */
  centered?: boolean;
}) {
  return (
    <div className={cn("sv-empty sv-card--soft border border-dashed border-line bg-surface", !centered && "sv-empty--compact", className)}>
      <IconCircle icon={icon} tone={tone} size={centered ? 56 : 40} />
      <div className="sv-empty__body min-w-0">
        <h3 className="sv-empty__title">{title}</h3>
        {children ? <div className="sv-empty__text">{children}</div> : null}
        {stage ? <p className="mt-1 text-caption text-text-secondary">{stage}</p> : null}
      </div>
      {action ? <div className="sv-empty__action">{action}</div> : null}
    </div>
  );
}
