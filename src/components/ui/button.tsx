import { cn } from "@/lib/cn";

// Кнопка дизайн-системы (design/ds-step-1/components/core/Button.jsx, классы sv-btn). Этап 18б: вид из эталонных карточек.
// primary: главная зелёная, одна на экране; dark: тёмно-синяя для второго по важности действия; secondary: с обводкой
// на поверхности (в системе это outline); soft: мягкая голубая (в системе secondary); ghost: текстовая ссылкой;
// danger: обводка с красным текстом; onDark: на тёмной подложке
type Variant = "primary" | "secondary" | "soft" | "dark" | "ghost" | "onDark" | "danger";
type Size = "md" | "sm" | "lg";

const variants: Record<Variant, string> = {
  primary: "sv-btn--primary",
  secondary: "sv-btn--outline",
  soft: "sv-btn--secondary",
  dark: "sv-btn--dark",
  ghost: "sv-btn--text",
  danger: "sv-btn--danger",
  onDark: "border-transparent bg-transparent text-white/85 hover:bg-white/10 hover:text-white",
};

const sizes: Record<Size, string> = {
  md: "",
  sm: "sv-btn--sm",
  lg: "sv-btn--lg",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn("sv-btn", variants[variant], sizes[size], className);
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  loading = false,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; loading?: boolean }) {
  return (
    <button className={buttonClass(variant, size, cn(loading && "is-loading", className))} aria-busy={loading || undefined} {...props}>
      {children}
      {loading ? (
        <span className="sv-btn__spinner" aria-hidden="true">
          <span className="sv-spinner" />
        </span>
      ) : null}
    </button>
  );
}
