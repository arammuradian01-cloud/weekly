// Мелкие общие элементы интерфейса: аватар, скелетон, переключатель вида, фильтр-чип, поля формы.

import { cn } from "@/lib/cn";
import { plural } from "@/domain/dates";
import { avatarSrc, type AvatarPhoto } from "@/domain/people";

/** Тон аватара по имени, как в дизайн-системе (Avatar.jsx toneOf): восемь спокойных подложек, одно имя всегда одного цвета */
export function avatarTone(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 997;
  return (h % 8) + 1;
}

/** Мелкие аватары берут картинку 64×64, крупные и карточка 256×256 (этап 80): на экранах с плотностью 2 обе чёткие */
const SMALL_AVATARS = new Set(["xs", "sm", "md"]);

/**
 * Фото поверх инициалов (этап 80). Картинка непрозрачная (прозрачность заливается белым при загрузке), поэтому
 * инициалы под ней не видны, пока она есть, и видны, пока она грузится или если не загрузилась. alt пустой: рядом и так
 * стоит имя, а сам аватар скрыт от экранного диктора
 */
export function AvatarImage({ photo, size }: { photo: AvatarPhoto; size: "large" | "small" }) {
  const px = size === "small" ? 64 : 256;
  // eslint-disable-next-line @next/next/no-img-element -- картинка уже готовая, квадрат WebP по версии: оптимизация Next не нужна
  return <img src={avatarSrc(photo, size)} alt="" width={px} height={px} loading="lazy" decoding="async" className="sv-avatar__img" data-testid="avatar-photo" />;
}

/** Аватар с инициалами (sv-avatar). name: от него цвет; без name цвет от инициалов. photo: фото профиля поверх инициалов */
export function Avatar({
  text,
  name,
  size = "md",
  className,
  title,
  photo,
}: {
  text: string;
  name?: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
  /** Оставлено для совместимости: цвет теперь по имени */
  tone?: "navy" | "light";
  className?: string;
  title?: string;
  /** Фото профиля (этап 80): без него инициалы */
  photo?: AvatarPhoto | null;
}) {
  return (
    <span className={cn("sv-avatar", size !== "md" && `sv-avatar--${size}`, `sv-avatar--${avatarTone(name ?? text)}`, className)} title={title} aria-hidden="true" data-photo={photo ? "" : undefined}>
      {text}
      {photo ? <AvatarImage photo={photo} size={SMALL_AVATARS.has(size) ? "small" : "large"} /> : null}
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
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
  tone?: "default" | "danger";
  /** Отбор ни к чему не приведёт (например, ноль подходящих): чип выключен, пока не включён сам */
  disabled?: boolean;
}) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} disabled={disabled} className={cn("sv-pill shrink-0", tone === "danger" && "sv-pill--danger", active && "is-active")}>
      {children}
      {count !== undefined ? (
        <span className={cn("sv-counter", active ? (tone === "danger" ? "sv-counter--danger" : "") : "sv-counter--neutral")}>{count}</span>
      ) : null}
    </button>
  );
}

const control = "sv-control w-full";

/**
 * Счётчик знаков у поля (этап 43): молчит, пока места много, появляется, когда осталось меньше 20 знаков, и краснеет,
 * когда лимит превышен. Раньше «38 из 150» стоял у каждого поля заметнее самого поля. Экранному диктору число не
 * читается на каждый знак: живая область всегда в DOM и меняет текст только на порогах (20, 10, 0, превышение)
 */
export function CharCounter({ counter }: { counter?: { value: number; max: number } }) {
  if (!counter) return null;
  const left = counter.max - counter.value;
  const visible = left < 0 ? `${-left} ${plural(-left, "лишний знак", "лишних знака", "лишних знаков")}` : `${plural(left, "остался", "осталось", "осталось")} ${left} ${plural(left, "знак", "знака", "знаков")}`;
  const spoken = left < 0 ? "Лимит знаков превышен" : left === 0 ? "Знаков не осталось" : left <= 10 ? "Осталось меньше 10 знаков" : left < 20 ? "Осталось меньше 20 знаков" : "";
  return (
    <span className={cn("text-caption tabular-nums", left < 0 ? "text-danger-ink" : "text-muted")}>
      {left < 20 ? <span aria-hidden="true">{visible}</span> : null}
      <span className="sr-only" aria-live="polite">
        {spoken}
      </span>
    </span>
  );
}

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
        <CharCounter counter={counter} />
      </div>
      <textarea id={id} className={control} {...props} aria-describedby={[props["aria-describedby"], hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined} />
      {hint ? (
        <p id={`${id}-hint`} className="sv-field__hint">
          {hint}
        </p>
      ) : null}
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
      <select id={id} className={control} {...props} aria-describedby={[props["aria-describedby"], hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {hint ? (
        <p id={`${id}-hint`} className="sv-field__hint">
          {hint}
        </p>
      ) : null}
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
      <input id={id} className={control} {...props} aria-describedby={[props["aria-describedby"], hint ? `${id}-hint` : null].filter(Boolean).join(" ") || undefined} />
      {hint ? (
        <p id={`${id}-hint`} className="sv-field__hint">
          {hint}
        </p>
      ) : null}
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
