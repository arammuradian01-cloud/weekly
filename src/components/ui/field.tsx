import { cn } from "@/lib/cn";

export function Field({
  label,
  id,
  hint,
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string }) {
  return (
    <div className={cn("sv-field", className)}>
      <label htmlFor={id} className="sv-label">
        {label}
      </label>
      <input
        id={id}
        className="sv-control w-full"
        {...props}
      />
      {hint ? <p className="sv-field__hint">{hint}</p> : null}
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="sv-alert sv-alert--danger">
      {message}
    </p>
  );
}
