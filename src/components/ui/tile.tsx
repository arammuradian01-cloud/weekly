// Плитки как на главной сайта (дизайн-система: layout/Tile.jsx, sv-tile) и круг с иконкой (core/Icon.jsx IconCircle)

import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export type CircleTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

export function IconCircle({ icon: Icon, tone = "accent", size = 40, className }: { icon: LucideIcon; tone?: CircleTone; size?: number; className?: string }) {
  const iconSize = size >= 56 ? 26 : size >= 40 ? 20 : 16;
  return (
    <span className={cn("sv-icon-circle", `sv-icon-circle--${tone}`, className)} style={{ width: size, height: size }} aria-hidden="true">
      <Icon style={{ width: iconSize, height: iconSize }} strokeWidth={1.5} />
    </span>
  );
}

export function Tiles({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("sv-tiles", className)}>{children}</div>;
}

/**
 * Плитка: заголовок, подпись, иконка на круге, крупная цифра. tone: default, accent, brand (тёмно-синяя),
 * primary (зелёная, одна на экране). wide: на две колонки. Вся плитка ссылка
 */
export function Tile({
  href,
  title,
  sub,
  icon,
  iconTone,
  tone,
  wide,
  value,
  unit,
  children,
  label,
  headingLevel = 2,
}: {
  href: string;
  title: React.ReactNode;
  sub?: React.ReactNode;
  icon?: LucideIcon;
  iconTone?: CircleTone;
  tone?: "accent" | "brand" | "primary";
  wide?: boolean;
  value?: React.ReactNode;
  unit?: React.ReactNode;
  children?: React.ReactNode;
  /** Имя ссылки для экранного диктора, если текст плитки длинный */
  label?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  return (
    <Link href={href} className={cn("sv-tile", tone && `sv-tile--${tone}`, wide && "sv-tile--wide")} aria-label={label}>
      <div className="sv-tile__top">
        <div className="min-w-0">
          <H className="sv-tile__title">{title}</H>
          {sub ? <div className="sv-tile__sub">{sub}</div> : null}
        </div>
        {icon ? <IconCircle icon={icon} tone={iconTone ?? (tone === "brand" || tone === "primary" ? "neutral" : "accent")} /> : null}
      </div>
      {value !== undefined ? (
        <div className="sv-tile__value">
          {value}
          {unit ? <small>{unit}</small> : null}
        </div>
      ) : null}
      {children ? <div className="sv-tile__foot">{children}</div> : null}
    </Link>
  );
}
