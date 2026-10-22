// Режим управления доступен, но выключен (этап 64): что в нём станет видно и доступно, и ссылка на включение.
// Жалоба владельца: без режима управления он видел только свои команды и не понимал почему

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/cn";

export function ManageHint({ text, link = true, className }: { text: string; /** Ссылка «Включить режим управления» */ link?: boolean; className?: string }) {
  return (
    <p className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 rounded-control-lg border border-line bg-surface px-3 py-2 text-small text-ink", className)} data-testid="manage-hint">
      <ShieldCheck className="h-4 w-4 shrink-0 text-icon" aria-hidden="true" />
      <span className="min-w-0">{text}</span>
      {link ? (
        <Link href="/manage" className="inline-flex min-h-11 items-center font-medium text-link hover:underline sm:min-h-0">
          Включить режим управления
        </Link>
      ) : null}
    </p>
  );
}
