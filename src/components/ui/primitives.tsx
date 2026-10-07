// Мелкие общие элементы интерфейса: аватар, скелетон, переключатель вида, фильтр-чип, поля формы.

import { cn } from "@/lib/cn";

export function Avatar({ text, size = "md", tone = "navy", className }: { text: string; size?: "sm" | "md"; tone?: "navy" | "light"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
        size === "sm" ? "h-7 w-7 text-micro" : "h-9 w-9 text-caption",
        tone === "navy" ? "bg-navy text-white" : "bg-field text-ink ring-1 ring-line",
        className,
      )}
      aria-hidden="true"
    >
      {text}
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
    <div role="radiogroup" aria-label={label} className={cn("inline-flex rounded-lg bg-field p-1", className)}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-md px-3 text-small transition-colors",
              active ? "bg-surface font-semibold text-ink shadow-segment" : "text-muted hover:text-ink",
            )}
          >
            {o.label}
            {o.count !== undefined ? <span className={cn("tabular-nums", active ? "text-muted" : "text-muted/80")}>{o.count}</span> : null}
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
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 text-small transition-colors",
        active
          ? tone === "danger"
            ? "bg-danger-ink text-white"
            : "bg-navy text-white"
          : "bg-surface text-ink ring-1 ring-line hover:ring-border-strong",
      )}
    >
      {children}
      {count !== undefined ? <span className={cn("tabular-nums", active ? "text-white/75" : "text-muted")}>{count}</span> : null}
    </button>
  );
}

const control =
  "w-full rounded-lg border border-line bg-surface px-3.5 text-body text-ink placeholder:text-muted/70 hover:border-border-strong focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25 disabled:bg-field disabled:text-muted";

export function TextArea({
  label,
  id,
  hint,
  counter,
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; id: string; hint?: string; counter?: { value: number; max: number } }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
        {counter ? (
          <span className={cn("text-caption tabular-nums", counter.value > counter.max ? "text-danger-ink" : "text-muted")}>
            {counter.value} из {counter.max}
          </span>
        ) : null}
      </div>
      <textarea id={id} className={cn(control, "min-h-24 py-2.5 leading-relaxed")} {...props} />
      {hint ? <p className="text-caption text-muted">{hint}</p> : null}
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <select id={id} className={cn(control, "h-11 appearance-none bg-[length:16px] bg-[right_12px_center] bg-no-repeat pr-10")} style={{ backgroundImage: CHEVRON }} {...props}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? <p className="text-caption text-muted">{hint}</p> : null}
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={cn("text-sm font-medium text-ink", hideLabel && "sr-only")}>
        {label}
      </label>
      <input id={id} className={cn(control, "h-11")} {...props} />
      {hint ? <p className="text-caption text-muted">{hint}</p> : null}
    </div>
  );
}

const CHEVRON =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235a6e77' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")";

/** Подпись поля в карточке: что за поле и его значение */
export function Meta({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <dt className="text-caption text-muted">{label}</dt>
      <dd className="text-body text-ink">{children}</dd>
    </div>
  );
}
