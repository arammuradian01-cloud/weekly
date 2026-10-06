import { cn } from "@/lib/cn";

/** Пустое состояние: что здесь будет и когда. Три параллелограмма как тихий фирменный знак */
export function EmptyState({
  title,
  children,
  stage,
  className,
}: {
  title: string;
  children?: React.ReactNode;
  stage?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-start gap-4 rounded-xl border border-dashed border-line px-6 py-8 sm:flex-row sm:items-center sm:gap-6", className)}>
      <div className="flex shrink-0 items-end gap-1" aria-hidden="true">
        <span className="block h-7 w-4 -skew-x-12 rounded-sm bg-surface" />
        <span className="block h-10 w-4 -skew-x-12 rounded-sm bg-blue-soft" />
        <span className="block h-13 w-4 -skew-x-12 rounded-sm bg-green-soft" />
      </div>
      <div className="max-w-xl">
        <h3 className="text-title-sm font-semibold text-ink">{title}</h3>
        {children ? <div className="mt-1 text-body leading-relaxed text-muted">{children}</div> : null}
        {stage ? <p className="mt-2 text-caption text-muted">{stage}</p> : null}
      </div>
    </div>
  );
}
