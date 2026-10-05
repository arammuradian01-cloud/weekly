"use client";

import { CheckCircle2, X } from "lucide-react";
import { usePrototype } from "@/prototype/store";

/** «Сохранено» после каждой правки и отмена последнего действия в течение 5 секунд (раздел 7 ТЗ) */
export function Toaster() {
  const { toast, undo, dismissToast } = usePrototype();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6 lg:justify-end lg:px-10" role="status" aria-live="polite">
      {toast ? (
        <div
          key={toast.id}
          className="pointer-events-auto flex min-h-12 items-center gap-3 rounded-xl bg-navy py-2 pl-4 pr-2 text-[15px] text-white shadow-[0_16px_40px_-16px_rgba(0,42,58,0.6)] animate-[toast-in_180ms_ease-out]"
        >
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green" aria-hidden="true" />
          <span>{toast.text}</span>
          {toast.undo ? (
            <button type="button" onClick={undo} className="h-9 rounded-lg px-3 font-semibold text-blue hover:bg-white/10">
              Отменить
            </button>
          ) : null}
          <button type="button" onClick={dismissToast} className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-white/60 hover:bg-white/10 hover:text-white" aria-label="Скрыть">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
