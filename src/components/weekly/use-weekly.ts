"use client";

// Действие weekly с экрана: ответ сервера, тост и обновление страницы с сервера.

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { usePrototype } from "@/domain/store";
import type { Result } from "@/app/(app)/weekly/actions";

export function useRunWeekly() {
  const { notify } = usePrototype();
  const router = useRouter();
  return useCallback(
    async <T,>(action: () => Promise<Result<T>>, okText?: string, opts: { refresh?: boolean } = {}): Promise<T | null> => {
      try {
        const result = await action();
        if (!result.ok) {
          notify(result.error, "error");
          return null;
        }
        if (okText) notify(okText);
        if (opts.refresh !== false) router.refresh();
        return result.value;
      } catch {
        notify("Нет связи с сервером: правка не сохранилась", "error");
        return null;
      }
    },
    [notify, router],
  );
}
