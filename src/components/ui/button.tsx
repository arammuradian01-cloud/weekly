import { cn } from "@/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "onDark" | "danger";
type Size = "md" | "sm";

const variants: Record<Variant, string> = {
  // На зелёном тёмно-синий текст: белый на #0DD149 не проходит по контрасту
  primary: "bg-green text-navy hover:bg-green-600 disabled:bg-line disabled:text-muted",
  secondary: "bg-white text-navy border border-line hover:border-navy-600 disabled:text-muted",
  ghost: "text-navy hover:bg-surface disabled:text-muted",
  onDark: "text-white/85 hover:bg-white/10 hover:text-white",
  // Опасные действия вроде удаления: белый на тёмно-красном, контраст 6,6:1
  danger: "bg-danger-ink text-white hover:bg-danger-ink/90 disabled:bg-line disabled:text-muted",
};

const sizes: Record<Size, string> = {
  md: "h-11 px-5 text-[15px]",
  sm: "h-9 px-3.5 text-sm",
};

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition-colors disabled:cursor-not-allowed",
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
