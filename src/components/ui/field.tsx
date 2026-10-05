import { cn } from "@/lib/cn";

export function Field({
  label,
  id,
  hint,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <input
        id={id}
        className="h-11 rounded-lg border border-line bg-white px-3.5 text-[15px] text-ink placeholder:text-muted/70 hover:border-navy-600/40 focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25"
        {...props}
      />
      {hint ? <p className="text-[13px] text-muted">{hint}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-sm text-danger-ink">
      {message}
    </p>
  );
}
