import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "dark" | "ghost" | "onDark" | "danger";
type Size = "md" | "sm";

const variants: Record<Variant, string> = {
  // На зелёном тёмно-синий текст: белый на #0DD149 не проходит по контрасту. Одна зелёная кнопка на экране
  primary: "bg-green text-on-primary hover:bg-green-600 active:bg-green-700 disabled:bg-line disabled:text-disabled",
  // Второе действие: с обводкой на поверхности (дизайн-система, решение 6)
  secondary: "bg-surface text-ink border border-border-strong hover:border-icon hover:bg-row-hover disabled:text-disabled disabled:border-line",
  // Тёмная кнопка для второго по важности действия рядом с зелёной
  dark: "bg-navy text-white hover:bg-navy-700 active:bg-navy-900 disabled:bg-line disabled:text-disabled",
  ghost: "text-ink hover:bg-field disabled:text-disabled",
  onDark: "text-white/85 hover:bg-white/10 hover:text-white",
  // Опасные действия вроде удаления: на красном светлый текст, контраст 6,6:1 в светлой теме
  danger: "bg-danger-ink text-surface hover:bg-danger-ink/90 disabled:bg-line disabled:text-disabled",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-5 text-small",
  sm: "h-9 px-3.5 text-small",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-control font-semibold transition-colors duration-color disabled:cursor-not-allowed",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}
