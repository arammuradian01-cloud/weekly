"use client";

// Прогноз месяца (этап 32): загрузка бюджета и LBE из LRF и команда продукта. Только для владельца и администраторов в
// режиме управления. Загрузка в два шага: проверить, что прочитается, и загрузить. LRF ресурс не меняет

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrototype } from "@/domain/store";
import { applyPullAction, planPeopleAction, previewPullAction, setPlanOwnersAction, setPlanSourceAction } from "@/app/(app)/forecast/actions";
import { addMonths, monthLabel } from "@/lib/forecast/codes";
import { formatPlan } from "@/lib/plan/format";
import { productOf } from "@/lib/plan/spec";
import type { PlanPerson, PullPreview } from "@/lib/plan/types";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlays";
import { FormError } from "@/components/ui/field";
import { SelectField, TextInput } from "@/components/ui/primitives";
import { Delta } from "@/components/ui/data";
import { delta } from "./plan-ui";

export function PullDrawer({
  open,
  onOpenChange,
  month,
  serviceEmail,
  mode,
  sourceId,
  canSource,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  month: string;
  serviceEmail: string | null;
  mode: "google" | "imitation" | "off";
  sourceId: string;
  canSource: boolean;
}) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [target, setTarget] = useState(month);
  const [preview, setPreview] = useState<PullPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "load" | null>(null);
  const months = [addMonths(month, -1), month, addMonths(month, 1), addMonths(month, 2)];
  const [source, setSource] = useState(sourceId);
  const [link, setLink] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);

  const changeSource = async () => {
    setError(null);
    setSourceBusy(true);
    const r = await setPlanSourceAction(link);
    setSourceBusy(false);
    if (!r.ok) return setError(r.error);
    setSource(r.value);
    setLink("");
    setPreview(null);
    notify("Источник прогноза месяца изменён");
  };

  const check = async () => {
    setError(null);
    setPreview(null);
    setBusy("check");
    const r = await previewPullAction(target);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPreview(r.value);
  };

  const load = async () => {
    setError(null);
    setBusy("load");
    const r = await applyPullAction(target);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    notify(`Бюджет и LBE на ${monthLabel(target)} загружены`);
    onOpenChange(false);
    setPreview(null);
    router.push(`/forecast?month=${target}`);
    router.refresh();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Бюджет и LBE из LRF"
      description="Ресурс только читает LRF «INSURANCE & INVEST» через таблицу-связку. Корректировки команды при повторной загрузке остаются"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void check()} loading={busy === "check"} disabled={busy !== null} data-testid="plan-pull-check">
            Проверить LRF
          </Button>
          <Button onClick={() => void load()} loading={busy === "load"} disabled={busy !== null || !preview?.ready || preview.month !== target} data-testid="plan-pull-load">
            Загрузить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 py-4">
        <SelectField
          id="plan-pull-month"
          label="Месяц"
          value={target}
          onChange={(e) => {
            setTarget(e.target.value);
            setPreview(null);
          }}
          options={months.map((m) => ({ value: m, label: monthLabel(m) }))}
          hint="LBE заполняют за пять дней до начала месяца. После загрузки команда корректирует драйверы от этой версии"
        />
        <div className="flex flex-col gap-1 text-caption text-text-secondary">
          <p>
            Источник:{" "}
            <a href={`https://docs.google.com/spreadsheets/d/${source}/edit`} target="_blank" rel="noreferrer" className="font-semibold text-link underline-offset-2 hover:underline" data-testid="plan-source-link">
              таблица-связка с LRF
            </a>
            . В ней листы LRF подтягиваются формулой IMPORTRANGE, руками там ничего не правят.
          </p>
          {mode === "google" && serviceEmail ? <p>Если не читается, у служебного аккаунта {serviceEmail} должно быть право «Читатель» на таблицу-связку.</p> : null}
        </div>
        {canSource ? (
          <div className="flex flex-wrap items-end gap-2">
            <TextInput id="plan-source" label="Другая таблица-источник" placeholder="Ссылка на Google-таблицу" value={link} onChange={(e) => setLink(e.target.value)} autoComplete="off" className="min-w-0 flex-1" />
            <Button variant="secondary" onClick={() => void changeSource()} loading={sourceBusy} disabled={sourceBusy || !link.trim()}>
              Сменить источник
            </Button>
          </div>
        ) : null}
        {mode === "off" ? <p className="sv-alert sv-alert--warning">Ключ служебного аккаунта Google не задан на сервере: LRF не прочитать.</p> : null}
        <FormError message={error ?? undefined} />
        {preview ? (
          <div className="flex flex-col gap-3" data-testid="plan-pull-preview">
            {preview.problems.length ? (
              <div className="sv-alert sv-alert--danger" role="alert">
                <p className="font-semibold">Загрузить нельзя</p>
                <ul className="list-disc pl-5">
                  {preview.problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="sv-alert sv-alert--success">
                Всё читается. Корректировок за {preview.monthLabel}: {preview.adjustments}, они останутся.
              </p>
            )}
            {preview.notes.map((n) => (
              <p key={n} className="text-caption text-warning-ink">
                {n}
              </p>
            ))}
            {preview.changed.length ? (
              <div className="sv-alert sv-alert--warning" data-testid="plan-pull-changed">
                <p className="font-semibold">У этих корректировок поменялся LBE. Корректировка хранит значение, поэтому после загрузки проверьте её смысл</p>
                <ul className="list-disc pl-5">
                  {preview.changed.map((c) => (
                    <li key={`${c.product}-${c.metric}`}>
                      {c.product}, {c.metric.toLowerCase()}: корректировка {c.value}, LBE был {c.lbeBefore}, станет {c.lbeAfter}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="overflow-x-auto rounded-card border border-border">
              <table className="sv-datatable sv-datatable--stack">
                <caption className="sr-only">Выручка продуктов по версиям из LRF</caption>
                <thead>
                  <tr>
                    <th scope="col">Продукт</th>
                    <th scope="col" className="is-num">
                      Бюджет, млн
                    </th>
                    <th scope="col" className="is-num">
                      LBE, млн
                    </th>
                    <th scope="col" className="is-num">
                      LBE сейчас
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {preview.products.map((p) => (
                    <tr key={p.code}>
                      <td className="is-wide">
                        <div className="sv-datatable__name">
                          <span>{p.label}</span>
                          {p.missing.length ? <span className="sv-datatable__hint text-danger-ink">Не найдено: {p.missing.join(", ")}</span> : null}
                          {p.warnings.map((w) => (
                            <span key={w} className="sv-datatable__hint text-warning-ink">
                              {w}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="is-num" data-label="Бюджет, млн">
                        {formatPlan(p.revenue.budget, "mln")}
                      </td>
                      <td className="is-num" data-label="LBE, млн">
                        {formatPlan(p.revenue.lbe, "mln")}
                      </td>
                      <td className="is-num" data-label="LBE сейчас">
                        {p.revenue.before === null ? <span className="sv-datatable__muted">не загружено</span> : <Delta value={delta(p.revenue.lbe, p.revenue.before, "mln")} better="none" label="Изменение LBE" />}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

export function OwnersDrawer({ open, onOpenChange, product, owners, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; product: string; owners: PlanPerson[]; onSaved: (owners: PlanPerson[]) => void }) {
  const { notify } = usePrototype();
  const [people, setPeople] = useState<PlanPerson[] | null>(null);
  const [chosen, setChosen] = useState<string[]>(owners.map((o) => o.slug));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = productOf(product)?.label ?? product;

  useEffect(() => {
    if (!open || people) return;
    void planPeopleAction().then((r) => (r.ok ? setPeople(r.value) : setError(r.error)));
  }, [open, people]);

  // Открыли заново: несохранённый выбор не возвращается
  useEffect(() => {
    if (!open) return;
    setChosen(owners.map((o) => o.slug));
    setQuery("");
    setError(null);
  }, [open, owners]);

  const save = async () => {
    setError(null);
    setBusy(true);
    const r = await setPlanOwnersAction(product, chosen);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    notify(`Команда продукта «${label}» обновлена`);
    onSaved(r.value);
    onOpenChange(false);
  };

  const q = query.trim().toLowerCase();
  const list = (people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={`Команда продукта: ${label}`}
      description="Эти люди корректируют прогноз продукта. Владелец и администраторы в режиме управления могут всегда"
      footer={
        <Button onClick={() => void save()} loading={busy} disabled={busy || !people} data-testid="plan-owners-save">
          Сохранить
        </Button>
      }
    >
      <div className="flex flex-col gap-3 py-4">
        <TextInput id="plan-owners-search" label="Поиск по имени" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" />
        <FormError message={error ?? undefined} />
        {people === null && !error ? <p className="text-caption text-text-secondary">Загружаем список людей</p> : null}
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">Кто корректирует прогноз</legend>
          {list.map((p) => (
            <label key={p.slug} className="flex min-h-[40px] cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-field">
              <input
                type="checkbox"
                className="h-4 w-4 accent-blue-700"
                checked={chosen.includes(p.slug)}
                onChange={(e) => setChosen((prev) => (e.target.checked ? [...prev, p.slug] : prev.filter((s) => s !== p.slug)))}
              />
              <span>{p.name}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </Drawer>
  );
}
