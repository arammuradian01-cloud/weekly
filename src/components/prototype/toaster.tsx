"use client";

import { CheckCircle2, CircleAlert, X } from "lucide-react";
import { usePrototype } from "@/domain/store";

/** Тост по дизайн-системе (system/Toast.jsx, sv-toast). «Сохранено» после каждой правки и отмена последнего действия в течение 5 секунд (раздел 7 ТЗ). Ошибки сервера здесь же */
export function Toaster() {
  const { toast, undo, dismissToast } = usePrototype();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6 lg:justify-end lg:px-10" role="status" aria-live="polite">
      {toast ? (
        <div
          key={toast.id}
          className={`sv-toast ${toast.tone === "error" ? "sv-toast--error" : "sv-toast--success"} pointer-events-auto animate-toast-in`}
        >
          {toast.tone === "error" ? (
            <CircleAlert className="sv-toast__icon h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          ) : (
            <CheckCircle2 className="sv-toast__icon h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          )}
          <span>{toast.text}</span>
          {toast.undoToken || toast.onUndo ? (
            <button type="button" onClick={undo} className="h-9 rounded-control px-3 font-semibold text-accent hover:bg-white/10">
              Отменить
            </button>
          ) : null}
          <button type="button" onClick={dismissToast} className="inline-flex h-9 w-9 items-center justify-center rounded-control opacity-60 hover:bg-white/10 hover:opacity-100" aria-label="Скрыть">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
