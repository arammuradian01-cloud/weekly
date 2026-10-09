"use client";

// Журнал решений (этап 23): поиск с русскими словоформами, фильтр по состоянию, отмена с причиной.

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import { formatLong } from "@/domain/dates";
import type { DecisionView } from "@/domain/meeting";
import { cancelDecisionAction, searchDecisionsAction } from "@/app/(app)/meeting/actions";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { Figures } from "@/components/ui/data";
import { Modal } from "@/components/ui/overlays";
import { Segmented, TextArea } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";

type Status = "active" | "cancelled" | "all";

export function DecisionsJournal({ initial, teamIds, initialQuery = "" }: { initial: DecisionView[]; teamIds?: string[]; /** Запрос из адреса: сервер уже отобрал по нему */ initialQuery?: string }) {
  const { notify, manage, leads } = usePrototype();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState<Status>("all");
  const [items, setItems] = useState(initial);
  const [cancelling, setCancelling] = useState<DecisionView | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Свежий список с сервера, если фильтры не тронуты; иначе перечитываем по фильтру
  const filtered = query.trim() !== initialQuery || status !== "all";
  useEffect(() => {
    if (!filtered) setItems(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial]);
  const seq = useRef(0);
  useEffect(() => {
    if (!filtered) return;
    const my = ++seq.current;
    const t = setTimeout(async () => {
      const r = await searchDecisionsAction(query, status, teamIds);
      // Ответ на устаревший запрос не перекрывает свежий
      if (r.ok && my === seq.current) setItems(r.value);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status, initial]);

  const canCancel = manage || leads.length > 0;
  const cancel = async () => {
    if (!cancelling) return;
    if (!reason.trim()) return setError("Напишите, почему решение отменено");
    const r = await cancelDecisionAction(cancelling.id, reason);
    if (!r.ok) return setError(r.error);
    setItems((prev) => prev.map((d) => (d.id === r.value.id ? r.value : d)));
    setCancelling(null);
    setReason("");
    setError(null);
    notify("Решение отменено");
  };

  // Цифры журнала по исходному списку (команда или поиск из адреса): фильтр на экране их не меняет
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
  return (
    <div className="flex flex-col gap-4">
      {initial.length ? (
        <Figures
          label="Решения в цифрах"
          items={[
            { label: "В силе", value: initial.filter((d) => d.status === "active").length, testId: "dec-fig-active" },
            { label: "Отменено", value: initial.filter((d) => d.status === "cancelled").length, testId: "dec-fig-cancelled" },
            { label: "За последние 7 дней", value: initial.filter((d) => d.date >= weekAgo).length, testId: "dec-fig-week" },
            { label: "Без владельца", value: initial.filter((d) => d.status === "active" && !d.owner).length, tone: "warning", testId: "dec-fig-noowner" },
          ]}
        />
      ) : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:w-96">
          <span className="sr-only">Поиск по решениям</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по словам" className="sv-control h-11 w-full pl-9 pr-3 text-body" />
        </label>
        <Segmented<Status> label="Состояние" value={status} onChange={setStatus} options={[{ value: "all", label: "Все" }, { value: "active", label: "В силе" }, { value: "cancelled", label: "Отменённые" }]} />
      </div>
      {items.length === 0 ? (
        query ? (
          <EmptyState title="Ничего не нашлось" icon={Search}>
            Попробуйте другое слово: поиск понимает словоформы, «страховой» найдёт и «страховая».
          </EmptyState>
        ) : (
          <EmptyState
            title="Решений пока нет"
            action={
              <Link href="/weekly/meeting" className={buttonClass("secondary", "sm")}>
                Открыть встречу
              </Link>
            }
          >
            Решения появляются на встрече кнопкой «Записать решение».
          </EmptyState>
        )
      ) : (
        // Этап 36: таблица вместо сплошного текста. На телефоне строка становится карточкой
        <div className="sv-card sv-card--soft overflow-x-auto p-0">
          <table className="sv-datatable sv-datatable--stack" data-testid="decisions-table">
            <caption className="sr-only">Решения встреч</caption>
            <thead>
              <tr>
                <th scope="col">Решение</th>
                <th scope="col">Дата</th>
                <th scope="col">Встреча</th>
                <th scope="col">Владелец</th>
                <th scope="col">Задачи</th>
                <th scope="col">Состояние</th>
                <th scope="col">
                  <span className="sr-only">Действия</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id}>
                  <td className="is-wide sv-decision__text">
                    <span className={d.status === "cancelled" ? "text-muted line-through" : "text-ink"}>{d.text}</span>
                    {d.cancelReason ? <span className="mt-1 block text-caption text-muted">Причина отмены: {d.cancelReason}</span> : null}
                  </td>
                  <td data-label="Дата" className="whitespace-nowrap">
                    {formatLong(d.date)}
                  </td>
                  <td data-label="Встреча">
                    {d.meeting ? (
                      <Link href={`/weekly/meeting?week=${d.meeting.week}`} className="text-link hover:underline">
                        {d.meeting.team}, неделя {d.meeting.number}
                      </Link>
                    ) : (
                      <span className="text-muted">нет</span>
                    )}
                  </td>
                  <td data-label="Владелец">{d.owner ? compactName(d.owner) : <span className="text-muted">нет</span>}</td>
                  <td data-label="Задачи">
                    {d.tasks.length ? (
                      d.tasks.map((t, i) => (
                        <Link key={t.number} href={`/tasks/${t.number}`} className="tabular-nums text-link hover:underline">
                          {t.number}
                          {i < d.tasks.length - 1 ? ", " : ""}
                        </Link>
                      ))
                    ) : (
                      <span className="text-muted">нет</span>
                    )}
                  </td>
                  <td data-label="Состояние">
                    <Badge tone={d.status === "active" ? "green" : "gray"}>{d.status === "active" ? "В силе" : "Отменено"}</Badge>
                  </td>
                  <td className="is-action">
                    {canCancel && d.status === "active" ? (
                      <Button size="sm" variant="ghost" onClick={() => setCancelling(d)} aria-label={`Отменить решение: ${d.text.slice(0, 60)}`}>
                        Отменить
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Modal open={cancelling !== null} onOpenChange={(o) => !o && setCancelling(null)} title="Отменить решение?" description={cancelling?.text}>
        <div className="flex flex-col gap-4">
          <TextArea label="Почему" id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} autoFocus />
          <FormError message={error ?? undefined} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={() => setCancelling(null)}>
              Оставить в силе
            </Button>
            <Button variant="danger" onClick={() => void cancel()}>
              Отменить решение
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
