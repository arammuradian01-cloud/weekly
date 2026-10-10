// Заголовок страницы по дизайн-системе (layout/PageHeader.jsx, sv-page-head): заголовок с меткой, подпись,
// действия справа (одна главная зелёная), вкладки снизу. Раздел страницы: Section с заголовком, счётчиком и ссылкой

import Link from "next/link";
import { cn } from "@/lib/cn";

export function PageHeader({
  title,
  description,
  children,
  badge,
  tabs,
  figures,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** Действия справа */
  children?: React.ReactNode;
  /** Метка рядом с заголовком */
  badge?: React.ReactNode;
  /** Вкладки под заголовком */
  tabs?: React.ReactNode;
  /** Ключевые цифры раздела под заголовком (этап 36): Figures */
  figures?: React.ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("sv-page-head", className)}>
      <div className="sv-page-head__row">
        <div className="sv-page-head__titles">
          <h1 className="sv-page-head__title">
            {title}
            {badge}
          </h1>
          {description ? <div className="sv-page-head__sub">{description}</div> : null}
        </div>
        {children ? <div className="sv-page-head__actions">{children}</div> : null}
      </div>
      {figures}
      {tabs}
    </header>
  );
}

/** Раздел страницы: заголовок, счётчик, подсказка, ссылка «Все» справа */
export function Section({
  title,
  count,
  hint,
  link,
  actions,
  children,
  className,
  id,
}: {
  title: string;
  count?: number;
  hint?: React.ReactNode;
  link?: { href: string; label: string };
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={cn("sv-section", className)} aria-label={title} id={id}>
      <div className="sv-section__head">
        <h2 className="sv-section__title">
          {title}
          {count !== undefined ? <span className="sv-section__count">{count}</span> : null}
        </h2>
        {hint ? <span className="sv-section__hint">{hint}</span> : null}
        {link ? (
          <Link className="sv-section__link" href={link.href}>
            {link.label}
          </Link>
        ) : null}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
