"use client";

import { useState } from "react";
import { CheckCircle2, CloudUpload, RotateCcw, TriangleAlert } from "lucide-react";
import { usePrototype } from "@/prototype/store";
import { formatShort, addDays } from "@/prototype/dates";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";

const RUNS = [
  { time: "03:41", items: 3, result: "ok" },
  { time: "03:40", items: 1, result: "ok" },
  { time: "03:12", items: 7, result: "ok" },
  { time: "02:55", items: 2, result: "retry" },
  { time: "02:54", items: 2, result: "ok" },
] as const;

/** Страница синхронизации для владельца: последняя выгрузка, очередь, ошибки (раздел 5 ТЗ) */
export function SyncStatus() {
  const { data, notify } = usePrototype();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl bg-green-soft px-5 py-4">
          <p className="inline-flex items-center gap-2 text-[14px] font-medium text-green-ink">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            Последняя выгрузка
          </p>
          <p className="mt-1 text-[28px] font-semibold tabular-nums text-ink">1 мин назад</p>
          <p className="text-[13px] text-muted">Изменение в ресурсе видно в таблице примерно через минуту</p>
        </div>
        <div className="rounded-xl bg-surface px-5 py-4">
          <p className="text-[14px] font-medium text-muted">Очередь отправки</p>
          <p className="mt-1 text-[28px] font-semibold tabular-nums text-ink">0</p>
          <p className="text-[13px] text-muted">Пакет уходит раз в 30 секунд</p>
        </div>
        <div className="rounded-xl bg-surface px-5 py-4">
          <p className="text-[14px] font-medium text-muted">Сверка с таблицей</p>
          <p className="mt-1 text-[28px] font-semibold tabular-nums text-ink">0 расхождений</p>
          <p className="text-[13px] text-muted">Ночью {formatShort(data.today)} в 03:00</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => notify("Выгрузка запущена")}>
          <CloudUpload className="h-4 w-4" aria-hidden="true" />
          Выгрузить сейчас
        </Button>
        <Button variant="secondary" onClick={() => setConfirm(true)}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Пересобрать вкладки
        </Button>
      </div>

      <section aria-labelledby="sync-tabs">
        <h2 id="sync-tabs" className="mb-3 text-[19px] font-semibold text-ink">Вкладки ресурса в таблице</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {[
            ["Задачи", `${data.tasks.length} строк`],
            ["Комментарии к задачам", `${data.tasks.reduce((n, t) => n + t.comments.length, 0)} строк`],
            ["Weekly", `${data.entries.length} строк`],
            ["Журнал выгрузки", "последние 1000 событий"],
          ].map(([name, note]) => (
            <li key={name} className="flex items-center justify-between rounded-lg px-4 py-3 ring-1 ring-line">
              <span className="text-[15px] font-medium text-ink">{name}</span>
              <span className="text-[14px] text-muted">{note}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[14px] text-muted">
          Пишет только служебный аккаунт Google. Отчёт CEO в таблицу не выгружается. Разработка идёт на копии таблицы, прод подключается на этапе 7 с согласия Арама.
        </p>
      </section>

      <section aria-labelledby="sync-log">
        <h2 id="sync-log" className="mb-3 text-[19px] font-semibold text-ink">Журнал выгрузок</h2>
        <ul className="divide-y divide-line rounded-xl ring-1 ring-line">
          {RUNS.map((r, i) => (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[15px]">
              <span className="tabular-nums text-muted">
                {formatShort(data.today)}, {r.time}
              </span>
              <span className="text-ink">Изменений: {r.items}</span>
              {r.result === "ok" ? (
                <span className="inline-flex items-center gap-1.5 text-green-ink">
                  <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                  Выгружено
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-warning-ink">
                  <TriangleAlert className="h-4 w-4" aria-hidden="true" />
                  Google не ответил, повторили через минуту
                </span>
              )}
            </li>
          ))}
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-[15px]">
            <span className="tabular-nums text-muted">{formatShort(addDays(data.today, -3))}, 03:00</span>
            <span className="text-ink">Сверка</span>
            <span className="inline-flex items-center gap-1.5 text-warning-ink">
              <TriangleAlert className="h-4 w-4" aria-hidden="true" />
              Задача 21: статус правили в таблице руками, вернули значение ресурса
            </span>
          </li>
        </ul>
      </section>

      <Modal open={confirm} onOpenChange={setConfirm} title="Пересобрать вкладки ресурса?" description="Вкладки «Задачи», «Комментарии к задачам», «Weekly» и «Журнал выгрузки» перепишутся целиком из ресурса. Остальные вкладки таблицы не трогаем.">
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirm(false)}>
            Отмена
          </Button>
          <Button
            onClick={() => {
              setConfirm(false);
              notify("Вкладки пересобираются");
            }}
          >
            Пересобрать
          </Button>
        </div>
      </Modal>
    </div>
  );
}
