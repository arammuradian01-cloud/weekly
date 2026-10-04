import { cn } from "@/lib/cn";

/** Цвет никогда не единственный носитель смысла: в метке всегда есть слово (раздел 7 ТЗ) */
export type BadgeTone = "green" | "blue" | "yellow" | "red" | "gray" | "outline" | "navy";

const tones: Record<BadgeTone, string> = {
  green: "bg-green-soft text-[#08732a]",
  blue: "bg-blue-soft text-blue-700",
  yellow: "bg-warning-soft text-[#7a5400]",
  red: "bg-danger-soft text-danger",
  gray: "bg-surface text-muted",
  outline: "bg-white text-ink ring-1 ring-line",
  navy: "bg-navy text-white",
};

export function Badge({ tone = "gray", children, className }: { tone?: BadgeTone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[13px] font-medium", tones[tone], className)}>
      {children}
    </span>
  );
}
