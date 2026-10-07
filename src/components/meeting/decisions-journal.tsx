"use client";

// Журнал решений (этап 23): поиск с русскими словоформами, фильтр по состоянию, отмена с причиной.

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { compactName } from "@/domain/people";
import { formatLong } from "@/domain/dates";
import type { DecisionView } from "@/domain/meeting";
import { cancelDecisionAction, searchDecisionsAction } from "@/app/(app)/meeting/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { Segmented, TextArea } from "@/components/ui/primitives";
import { FormError } from "@/components/ui/field";

type Status = "active" | "cancelled" | "all";

export function DecisionsJournal({ initial, teamIds }: { initial: DecisionView[]; teamIds?: string[] }) {
  const { notify, manage, leads } = usePrototype();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<Status>("all");
  const [items, setItems] = useState(initial);
  const [cancelling, setCancelling] = useState<DecisionView | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setItems(initial), [initial]);

  useEffect(() => {
    const t = setTimeout(async () => {
      const r = await searchDecisionsAction(query, status, teamIds);
      if (r.ok) setItems(r.value);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, status]);

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

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="relative block sm:w-96">
          <span className="sr-only">Поиск по решениям</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по словам" className="h-11 w-full rounded-lg border border-line bg-white pl-9 pr-3 text-body text-ink focus:border-blue focus:outline-none focus:ring-3 focus:ring-blue/25" />
        </label>
        <Segmented<Status> label="Состояние" value={status} onChange={setStatus} options={[{ value: "all", label: "Все" }, { value: "active", label: "В силе" }, { value: "cancelled", label: "Отменённые" }]} />
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl bg-surface px-5 py-6 text-body text-muted">{query ? "Ничего не нашлось." : "Решений пока нет. Они появляются на встрече кнопкой «Записать решение»."}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
          {items.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className={d.status === "cancelled" ? "text-body text-muted line-through" : "text-body text-ink"}>{d.text}</p>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted">
                  <Badge tone={d.status === "active" ? "green" : "gray"}>{d.status === "active" ? "В силе" : "Отменено"}</Badge>
                  <span>{formatLong(d.date)}</span>
                  {d.meeting ? (
                    <Link href={`/weekly/meeting?week=${d.meeting.week}`} className="hover:underline">
                      Встреча {d.meeting.team}, неделя {d.meeting.number}
                    </Link>
                  ) : null}
                  {d.owner ? <span>Владелец: {compactName(d.owner)}</span> : null}
                  {d.tasks.length ? (
                    <span>
                      Задачи:{" "}
                      {d.tasks.map((t, i) => (
                        <Link key={t.number} href={`/tasks/${t.number}`} className="tabular-nums hover:underline">
                          {t.number}
                          {i < d.tasks.length - 1 ? ", " : ""}
                        </Link>
                      ))}
                    </span>
                  ) : null}
                  {d.cancelReason ? <span>Причина: {d.cancelReason}</span> : null}
                </p>
              </div>
              {canCancel && d.status === "active" ? (
                <Button size="sm" variant="ghost" onClick={() => setCancelling(d)} className="shrink-0">
                  Отменить
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
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
