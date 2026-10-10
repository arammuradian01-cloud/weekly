"use client";

// Поле выбора файла (этап 40): своя кнопка «Выбрать файл» вместо системной, у которой подпись на языке браузера
// («Choose File», «No file chosen») и второе имя файла. Само поле скрыто, но доступно с клавиатуры: фокус виден на подписи

import { FileUp } from "lucide-react";
import { cn } from "@/lib/cn";

export function FileField({
  id,
  label,
  accept,
  fileName,
  hint,
  onChange,
  className,
}: {
  id: string;
  label: string;
  accept?: string;
  /** Имя выбранного файла; null: «Файл не выбран» */
  fileName: string | null;
  hint?: string;
  onChange: (file: File | null) => void;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <input id={id} type="file" accept={accept} className="peer sr-only" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      <label htmlFor={id} className="flex cursor-pointer flex-col gap-1.5 rounded-lg peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-blue">
        <span className="sv-label">{label}</span>
        <span className="flex min-w-0 items-center gap-3">
          <span className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg bg-field px-4 text-small font-medium text-ink hover:bg-line">
            <FileUp className="h-4 w-4" aria-hidden="true" />
            Выбрать файл
          </span>
          <span className="truncate text-small text-muted">{fileName ?? "Файл не выбран"}</span>
        </span>
      </label>
      {hint ? <p className="text-caption text-text-secondary">{hint}</p> : null}
    </div>
  );
}
