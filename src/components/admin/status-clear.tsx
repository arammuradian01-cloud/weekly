"use client";

// Кнопка «Очистить список сбоев» на странице «Состояние» (этап 86).
//
// Зачем: предел на число новых сбоев ограничивает скорость, а не объём, и часть записей приходит из открытого
// обработчика /api/errors, то есть с чужим текстом. Без кнопки почистить их можно было только доступом к базе.
// Нажатие пишется в журнал. Удаляются только технические записи о сбоях: данных задач и weekly в них нет.

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { clearErrorsAction } from "@/app/(app)/status/actions";

export function ClearErrors({ count }: { count: number }) {
  const run = useRunAction();
  const [busy, setBusy] = useState(false);
  if (!count) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      loading={busy}
      disabled={busy}
      data-testid="status-errors-clear"
      onClick={async () => {
        setBusy(true);
        await run(() => clearErrorsAction(), "Список сбоев очищен");
        setBusy(false);
      }}
    >
      Очистить список сбоев
    </Button>
  );
}
