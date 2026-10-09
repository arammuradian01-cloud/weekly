// Общие элементы для разделов с цифрами (этап 32): плитка ключевой цифры, изменение со знаком, модуль страницы с
// пояснением и параметрами. Стили в src/styles/ds-data.css

import Link from "next/link";
import { cn } from "@/lib/cn";

export type DeltaValue = { text: string; pct: string | null; sign: -1 | 0 | 1 };

/**
 * Изменение со знаком. better: какое направление хорошее (выручка растёт, расходы падают). Цвет подсказывает оценку, знак
 * и текст говорят направление, поэтому смысл не держится на одном цвете. label: для чтения экранным диктором
 */
export function Delta({ value, better = "up", label, className }: { value: DeltaValue | null; better?: "up" | "down" | "none"; label?: string; className?: string }) {
  if (!value) return <span className={cn("text-caption text-text-secondary", className)}>нет</span>;
  const tone = value.sign === 0 || better === "none" ? (value.sign === 0 ? "flat" : null) : (value.sign > 0) === (better === "up") ? "good" : "bad";
  return (
    <span className={cn("sv-delta", tone && `sv-delta--${tone}`, className)} aria-label={label ? `${label}: ${value.text}${value.pct ? `, ${value.pct}` : ""}` : undefined}>
      <span>{value.text}</span>
      {value.pct ? <span className="sv-delta__pct">{value.pct}</span> : null}
    </span>
  );
}

export type StatCompare = { label: string; value: string; delta: DeltaValue | null };

/** Плитка ключевой цифры: подпись, крупное значение с единицей, сравнение с другими версиями */
export function StatTile({
  label,
  value,
  unit,
  compare,
  better = "up",
  note,
  className,
  testId,
}: {
  label: string;
  value: string;
  unit?: string;
  compare?: StatCompare[];
  better?: "up" | "down" | "none";
  note?: React.ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section className={cn("sv-stat", className)} aria-label={label} data-testid={testId}>
      <span className="sv-stat__label">{label}</span>
      <span className="sv-stat__value">
        {value}
        {unit ? <span className="sv-stat__unit">{unit}</span> : null}
      </span>
      {compare?.length ? (
        <dl className="sv-stat__compare">
          {compare.map((c) => (
            <div key={c.label} className="contents">
              <dt>{c.label}</dt>
              <dd>{c.value}</dd>
              <dd>
                <Delta value={c.delta} better={better} label={`К ${c.label.toLowerCase()}`} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {note ? <span className="sv-stat__note">{note}</span> : null}
    </section>
  );
}

export function Stats({ children, className, label }: { children: React.ReactNode; className?: string; label?: string }) {
  return (
    <div className={cn("sv-stats", className)} role="group" aria-label={label}>
      {children}
    </div>
  );
}

export type Param = { label: string; value: React.ReactNode };

/** Модуль страницы: название, пояснение, действия справа, параметры строкой и содержимое */
export function Module({
  title,
  description,
  actions,
  params,
  children,
  flush,
  foot,
  id,
  className,
  headingLevel = 2,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  params?: Param[];
  children?: React.ReactNode;
  /** Содержимое во всю ширину без отступов: таблица */
  flush?: boolean;
  foot?: React.ReactNode;
  id?: string;
  className?: string;
  headingLevel?: 2 | 3;
}) {
  const H = headingLevel === 2 ? "h2" : "h3";
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section className={cn("sv-module", className)} id={id} aria-labelledby={headingId}>
      <div className="sv-module__head">
        <div className="sv-module__titles">
          <H className="sv-module__title" id={headingId}>
            {title}
          </H>
          {description ? <p className="sv-module__desc">{description}</p> : null}
        </div>
        {actions ? <div className="sv-module__actions">{actions}</div> : null}
      </div>
      {params?.length ? (
        <dl className="sv-params">
          {params.map((p) => (
            <div key={p.label}>
              <dt>{p.label}</dt>
              <dd>{p.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {children ? <div className={cn("sv-module__body", flush && "sv-module__body--flush")}>{children}</div> : null}
      {foot ? <div className="sv-module__foot">{foot}</div> : null}
    </section>
  );
}

/** Вкладки страницы ссылками: активная отмечена для экранного диктора */
export function PageTabs({ tabs, label }: { tabs: { href: string; label: string; active: boolean; testId?: string }[]; label: string }) {
  return (
    <nav className="sv-tabs mt-4" aria-label={label}>
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={cn("sv-tabs__item", t.active && "is-active")} aria-current={t.active ? "page" : undefined} data-testid={t.testId}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
