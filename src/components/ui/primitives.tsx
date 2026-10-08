// Мелкие общие элементы интерфейса: аватар, скелетон, переключатель вида, фильтр-чип, поля формы.

import { cn } from "@/lib/cn";

/** Тон аватара по имени, как в дизайн-системе (Avatar.jsx toneOf): восемь спокойных подложек, одно имя всегда одного цвета */
export function avatarTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return (h % 8) + 1;
}

/** Аватар с инициалами (sv-avatar). name: от него цвет; без name цвет от инициалов */
export function Avatar({
  text,
  name,
  size = "md",
  className,
  title,
}: {
  text: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg";
  /** Оставлено для совместимости: цвет теперь по имени */
  tone?: "navy" | "light";
  className?: string;
  title?: string;
}) {
  return (
    <span className={cn("sv-avatar", size !== "md" && `sv-avatar--${size}`, `sv-avatar--${avatarTone(name ?? text)}`, className)} title={title} aria-hidden="true">
      {text}
    </span>
  );
}

/** Счётчик-бейдж (sv-counter): в меню, у вкладок и фильтров. Ноль не показывается */
export function Counter({ value, tone, className, label }: { value: number; tone?: "neutral" | "danger" | "inverse"; className?: string; label?: string }) {
  if (!value) return null;
  return (
    <span className={cn("sv-counter", tone && `sv-counter--${tone}`, className)} aria-label={label}>
      {value > 99 ? "99+" : value}
    </span>
  );
}

/** Скелетон на время загрузки: серый блок с мягкой пульсацией (отключается при reduced motion) */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cn("block animate-pulse rounded-md bg-field", className)} aria-hidden="true" />;
}

export type SegmentOption<V extends string> = { value: V; label: string; count?: number };

/** Переключатель вида: список, доска, мои; по людям, по блокам */
export function Segmented<V extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("sv-segment max-w-full flex-wrap", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={active} onClick={() => onChange(o.value)} className={cn("sv-segment__item", active && "is-active")}>
            {o.label}
            {o.count !== undefined ? <span className="sv-counter sv-counter--neutral">{o.count}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Быстрый фильтр: включается и выключается одним нажатием */
export function Chip({
  active,
  onClick,
  children,
  count,
  tone = "default",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  tone?: "default" | "danger";
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={cn("sv-pill shrink-0", tone === "danger" && "sv-pill--danger", active && "is-active")}>
      {children}
      {count !== undefined ? (
        <span className={cn("sv-counter", active ? (tone === "danger" ? "sv-counter--danger" : "") : "sv-counter--neutral")}>{count}</span>
      ) : null}
    </button>
  );
}

const control = "sv-control w-full";

export function TextArea({
  label,
  id,
  hint,
  counter,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; id: string; hint?: string; counter?: { value: number; max: number } }) {
  return (
    <div className={cn("sv-field", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="sv-label">
          {label}
        </label>
        {counter ? (
          <span className={cn("text-caption tabular-nums", counter.value > counter.max ? "text-danger-ink" : "text-muted")}>
            {counter.value} из {counter.max}
          </span>
        ) : null}
      </div>
      <textarea id={id} className={control} {...props} />
      {hint ? <p className="sv-field__hint">{hint}</p> : null}
    </div>
  );
}

export function SelectField({
  label,
  id,
  options,
  hint,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; options: { value: string; label: string }[]; hint?: string }) {
  return (
    <div className={cn("sv-field", className)}>
      <label htmlFor={id} className="sv-label">
        {label}
      </label>
      <select id={id} className={control} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <p className="sv-field__hint">{hint}</p> : null}
    </div>
  );
}

export function TextInput({
  label,
  id,
  hint,
  className,
  hideLabel,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string; /** Подпись только для экранного диктора: поле в строке, где подпись и так ясна */ hideLabel?: boolean }) {
  return (
    <div className={cn("sv-field", className)}>
      <label htmlFor={id} className={cn("sv-label", hideLabel && "sr-only")}>
        {label}
      </label>
      <input id={id} className={control} {...props} />
      {hint ? <p className="sv-field__hint">{hint}</p> : null}
    </div>
  );
}


/** Подпись поля в карточке: что за поле и его значение */
export function Meta({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <dt className="text-caption text-text-secondary">{label}</dt>
      <dd className="text-body text-ink">{children}</dd>
    </div>
  );
}
