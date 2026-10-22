"use client";

// Прогноз месяца (этап 32): загрузка бюджета и LBE из LRF и команда продукта. Только для владельца и администраторов в
// режиме управления. Загрузка в два шага: проверить, что прочитается, и загрузить. LRF ресурс не меняет

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrototype } from "@/domain/store";
import { applyFactsAction, applyHubAction, applyPullAction, planPeopleAction, previewFactsAction, previewHubAction, previewPullAction, setHubSourceAction, setPlanOwnersAction, setPlanSourceAction, setSkAliasesAction } from "@/app/(app)/forecast/actions";
import type { HubPreview, HubSourceView } from "@/lib/plan/hub-service";
import type { FactsPreview } from "@/lib/plan/processes";
import { FACT_METRICS } from "@/lib/plan/facts";
import { addMonths, monthLabel } from "@/lib/forecast/codes";
import { formatPlan } from "@/lib/plan/format";
import { productOf } from "@/lib/plan/spec";
import type { PlanPerson, PullPreview } from "@/lib/plan/types";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlays";
import { FormError } from "@/components/ui/field";
import { SelectField, TextArea, TextInput } from "@/components/ui/primitives";
import { Delta } from "@/components/ui/data";
import { delta, when } from "./plan-ui";

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
    // Остаёмся на той вкладке, с которой открыли панель (этап 46)
    router.push(`/forecast?month=${target}${window.location.search.includes("tab=partners") ? "&tab=partners" : ""}`);
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
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
            <TextInput id="plan-source" label="Другая таблица-источник" placeholder="Ссылка на Google-таблицу" value={link} onChange={(e) => setLink(e.target.value)} autoComplete="off" className="min-w-0 flex-1" />
            <Button variant="secondary" onClick={() => void changeSource()} loading={sourceBusy} disabled={sourceBusy || !link.trim()} className="sm:shrink-0">
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
            <PartnersPreview p={preview.partners} />
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

/** Партнёрский канал в проверке загрузки (этап 35б): загрузится ли, сколько партнёров, выручка LBE и бюджет канала */
function PartnersPreview({ p }: { p: PullPreview["partners"] }) {
  return (
    <div className="flex flex-col gap-2" data-testid="plan-pull-partners">
      {!p.found ? (
        <p className="text-caption text-text-secondary">
          Партнёрский канал: листов LRF b2b в источнике нет, партнёры не загрузятся. Они появятся, когда листы b2b свяжут с таблицей-связкой.
          {p.before ? ` Останутся партнёры прежней загрузки: ${p.before}.` : ""}
        </p>
      ) : p.ready ? (
        <p className="sv-alert sv-alert--success">
          Партнёрский канал загрузится. Партнёров: {p.lines}, выручка LBE {formatPlan(p.revenue.lbe, "mln")} млн, бюджет канала {formatPlan(p.revenue.budget, "mln")} млн.{p.before ? ` Сейчас загружено партнёров: ${p.before}, корректировки команды канала останутся.` : ""}
        </p>
      ) : (
        <div className="sv-alert sv-alert--warning">
          <p className="font-semibold">Партнёрский канал не загрузится, продукты загрузятся</p>
          <ul className="list-disc pl-5">
            {p.problems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
          {p.before ? <p>Останутся партнёры прежней загрузки: {p.before}.</p> : null}
        </div>
      )}
      {p.warnings.map((w) => (
        <p key={w} className="text-caption text-warning-ink">
          {w}
        </p>
      ))}
    </div>
  );
}

export function OwnersDrawer({ open, onOpenChange, product, owners, onSaved }: { open: boolean; onOpenChange: (open: boolean) => void; product: string; owners: PlanPerson[]; onSaved: (owners: PlanPerson[]) => void }) {
  const { notify } = usePrototype();
  const [people, setPeople] = useState<PlanPerson[] | null>(null);
  const [chosen, setChosen] = useState<string[]>(owners.map((o) => o.slug));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = productOf(product)?.label ?? (product === "b2b" ? "Партнёрский канал" : product);
  const noun = product === "b2b" ? "канала" : "продукта";

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
    notify(`Команда ${noun} «${label}» обновлена`);
    onSaved(r.value);
    onOpenChange(false);
  };

  const q = query.trim().toLowerCase();
  const list = (people ?? []).filter((p) => !q || p.name.toLowerCase().includes(q));
  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      title={product === "b2b" ? `Команда канала: ${label}` : `Команда продукта: ${label}`}
      description={`Эти люди корректируют прогноз ${noun}. Владелец и администраторы в режиме управления могут всегда`}
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

const FACT_EXAMPLE = ["Дата\tПродукт\tПродажи\tВыручка, млн\tПромо-маржа, млн", "01.10.2026\tОСАГО\t13450\t15,8\t5,9", "01.10.2026\tКАСКО\t2100\t3,2\t1,1"].join("\n");

/**
 * Факт месяца по дням (этап 35): вставка из отчёта аналитиков в два шага, как загрузка LRF: проверить и загрузить.
 * Тот же день продукта и показатель при повторной загрузке заменяется
 */
export function FactsDrawer({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<FactsPreview | null>(null);
  const [checked, setChecked] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "load" | null>(null);

  const check = async () => {
    setError(null);
    setPreview(null);
    setBusy("check");
    const r = await previewFactsAction(text);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPreview(r.value);
    setChecked(text);
  };

  const load = async () => {
    setError(null);
    setBusy("load");
    const r = await applyFactsAction(text);
    setBusy(null);
    if (!r.ok) return setError(r.error);
    notify(`Факт загружен: значений ${r.value.saved}${r.value.replaced ? `, заменено ${r.value.replaced}` : ""}`);
    onOpenChange(false);
    setText("");
    setPreview(null);
    router.refresh();
  };

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="Факт по дням"
      description="Продажи, выручка и промо-маржа продуктов за день из отчёта аналитиков. Скопируйте строки из таблицы вместе с заголовками и вставьте сюда"
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void check()} loading={busy === "check"} disabled={busy !== null || !text.trim()} data-testid="plan-facts-check">
            Проверить
          </Button>
          <Button onClick={() => void load()} loading={busy === "load"} disabled={busy !== null || !preview?.ready || checked !== text} data-testid="plan-facts-load">
            Загрузить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 py-4">
        <TextArea
          id="plan-facts-text"
          label="Строки отчёта"
          rows={8}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPreview(null);
          }}
          placeholder={FACT_EXAMPLE}
          className="font-mono"
        />
        <div className="flex flex-col gap-1 text-caption text-text-secondary">
          <p>Первая строка: «Дата», «Продукт» и колонки показателей ({FACT_METRICS.map((m) => `«${m.label}»`).join(", ")}). Можно и узким видом: «Дата», «Продукт», «Показатель», «Значение».</p>
          <p>Дата вида 01.10.2026. Продукт как в прогнозе: ОСАГО, КАСКО, Ипотечное страхование, ВЗР, Несчастный случай, Имущество, Клещ, Вклады. Деньги в миллионах; если в рублях, напишите в заголовке «Выручка, руб».</p>
        </div>
        <FormError message={error ?? undefined} />
        {preview ? (
          <div className="flex flex-col gap-3" data-testid="plan-facts-preview">
            {preview.problems.length ? (
              <div className="sv-alert sv-alert--danger" role="alert">
                <div className="sv-alert__body">
                  <p className="font-semibold">Загрузить нельзя</p>
                  <ul className="list-disc pl-5">
                    {preview.problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <p className="sv-alert sv-alert--success">
                Строк {preview.rows}, значений {preview.values}
                {preview.replaced ? `, из них заменят уже загруженные: ${preview.replaced}` : ""}.
              </p>
            )}
            {preview.products.length ? (
              <div className="overflow-x-auto">
                <table className="sv-datatable sv-datatable--stack">
                  <caption className="sr-only">Что загрузится по продуктам</caption>
                  <thead>
                    <tr>
                      <th scope="col">Продукт</th>
                      <th scope="col">Дни</th>
                      {FACT_METRICS.map((m) => (
                        <th key={m.key} scope="col" className="is-num">
                          {m.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.products.map((p) => (
                      <tr key={p.code}>
                        <td className="is-wide">{p.label}</td>
                        <td data-label="Дни">
                          {p.days} {p.days === 1 ? `(${p.from.split("-").reverse().join(".")})` : `(${p.from.split("-").reverse().join(".")} - ${p.to.split("-").reverse().join(".")})`}
                        </td>
                        {FACT_METRICS.map((m) => (
                          <td key={m.key} className="is-num" data-label={m.label}>
                            {p.totals[m.key] === undefined ? "нет" : formatPlan(p.totals[m.key]!, m.unit)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

// Хаб «Единая воронка: данные» (этап 58): снимок «Все СК» на сегодня и план ОСАГО по СК. Два шага: проверить и загрузить

const dmy = (day: string) => day.split("-").reverse().join(".");

/** Часть загрузки хаба в проверке: загрузится или нет, почему, о чём предупредить */
function HubPartCard({ title, part, summary, testId }: { title: string; part: HubPreview["fact"] | HubPreview["plan"]; summary: string | null; testId: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-card border border-border p-3" data-testid={testId}>
      <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-caption text-text-secondary">
        <span>{title}</span>
        <span className={part.ready ? "font-semibold text-green-ink" : "font-semibold text-danger-ink"}>{part.ready ? "загрузится" : "не загрузится"}</span>
      </p>
      <p>{summary ?? "не прочитано"}</p>
      {part.problems.length ? (
        <ul className="list-disc pl-5 text-caption text-danger-ink" role="alert">
          {part.problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      ) : null}
      {part.warnings.map((w) => (
        <p key={w} className="text-caption text-warning-ink">
          {w}
        </p>
      ))}
    </div>
  );
}

/** Когда загружена часть хаба: «Факт загружен 22 октября в 09:10, Мурадян Арам» */
const hubLoaded = (what: string, part: { at: string; by: string } | null) => (part ? `${what} загружен ${when(part.at)}${part.by ? `, ${part.by}` : ""}` : `${what} ещё не загружен`);

export function HubDrawer({ open, onOpenChange, source: hub, canSource }: { open: boolean; onOpenChange: (open: boolean) => void; source: HubSourceView; canSource: boolean }) {
  const router = useRouter();
  const { notify } = usePrototype();
  const { serviceEmail, mode } = hub;
  const [preview, setPreview] = useState<HubPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"check" | "load" | null>(null);
  const [source, setSource] = useState(hub.sourceId);
  const [link, setLink] = useState("");
  const [sourceBusy, setSourceBusy] = useState(false);
  // Подсказка у поля хаба, если «Задать хаб» нажали без ссылки (этап 59)
  const [sourceHint, setSourceHint] = useState<string | null>(null);
  // Соответствие названий СК (настройка plan.skAliases): правит владелец
  const [aliases, setAliases] = useState(hub.aliases ?? "");
  const [savedAliases, setSavedAliases] = useState(hub.aliases ?? "");
  const [aliasesBusy, setAliasesBusy] = useState(false);
  // Строка «сохранено» у поля (этап 59): кнопка после сохранения уходит, фокус возвращается в поле, а не теряется
  const [aliasesSaved, setAliasesSaved] = useState(false);

  const saveAliases = async () => {
    setError(null);
    setAliasesBusy(true);
    const r = await setSkAliasesAction(aliases);
    setAliasesBusy(false);
    if (!r.ok) return setError(r.error);
    setAliases(r.value);
    setSavedAliases(r.value);
    setAliasesSaved(true);
    document.getElementById("plan-hub-aliases-text")?.focus();
    setPreview(null);
    notify("Соответствие названий СК сохранено");
    router.refresh();
  };

  const changeSource = async () => {
    setError(null);
    // Кнопка не выключена серым (этап 59): без ссылки она говорит у поля, чего не хватает
    if (!link.trim()) return setSourceHint("Вставьте ссылку на Google-таблицу хаба");
    setSourceBusy(true);
    const r = await setHubSourceAction(link);
    setSourceBusy(false);
    if (!r.ok) return setError(r.error);
    setSource(r.value);
    setLink("");
    setPreview(null);
    notify("Хаб данных задан");
  };

  const check = async () => {
    setError(null);
    setPreview(null);
    setBusy("check");
    const r = await previewHubAction();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPreview(r.value);
  };

  const load = async () => {
    setError(null);
    setBusy("load");
    const r = await applyHubAction();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    const { day, fact, plan } = r.value;
    notify(
      fact.loaded && plan.loaded
        ? `Снимок «Все СК» на ${dmy(day)} и план по СК загружены`
        : fact.loaded
          ? `Снимок «Все СК» на ${dmy(day)} загружен. План по СК не загружен: ${plan.problem}`
          : `План по СК загружен. Снимок «Все СК» не загружен: ${fact.problem}`,
    );
    onOpenChange(false);
    setPreview(null);
    router.refresh();
  };

  const n = (v: number | null) => (v === null ? "нет" : Math.round(v).toLocaleString("ru-RU"));

  return (
    <Drawer
      open={open}
      onOpenChange={onOpenChange}
      wide
      title="ОСАГО по СК из хаба"
      // Одна строка о результате (этап 59), устройство загрузки свёрнуто ниже
      description="Загрузит факт по СК с начала месяца по вчерашний день и план месяца по СК."
      footer={
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void check()} loading={busy === "check"} disabled={busy !== null} data-testid="plan-hub-check">
            Проверить хаб
          </Button>
          <Button onClick={() => void load()} loading={busy === "load"} disabled={busy !== null || !preview?.ready} data-testid="plan-hub-load">
            Загрузить
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 py-4">
        <div className="flex flex-col gap-1 text-caption text-text-secondary">
          <p>
            Источник:{" "}
            {source ? (
              <a href={`https://docs.google.com/spreadsheets/d/${source}/edit`} target="_blank" rel="noreferrer" className="font-semibold text-link underline-offset-2 hover:underline" data-testid="plan-hub-link">
                хаб «Единая воронка: данные»
              </a>
            ) : (
              <span data-testid="plan-hub-link">хаб ещё не задан</span>
            )}
          </p>
          <p data-testid="plan-hub-loaded">
            {hubLoaded("Факт «Все СК»", hub.fact)}. {hubLoaded("План по СК", hub.plan)}.
          </p>
        </div>
        {/* Подробности для того, кто разбирается, почему не читается: свёрнуты (этап 59) */}
        <details className="text-caption text-text-secondary" data-testid="plan-hub-details">
          <summary className="cursor-pointer rounded-tag py-1 font-semibold text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Как устроена загрузка</summary>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            <li>Хаб «Единая воронка: данные» ресурс только читает: лист «Все СК» даёт факт по СК с начала месяца по вчерашний день, лист плана по СК даёт план месяца из модели.</li>
            <li>В хабе листы боевых файлов подтягиваются формулой IMPORTRANGE, руками там ничего не правят.</li>
            <li>Факт и план загружаются независимо: что прошло проверку, то и загрузится.</li>
            <li>Снимок делается на сегодня, повторная загрузка в тот же день его заменяет.</li>
            {mode === "google" && serviceEmail ? <li>Если хаб не читается, у служебного аккаунта {serviceEmail} должно быть право «Читатель» на хаб.</li> : null}
          </ul>
        </details>
        {canSource ? (
          <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <TextInput
                id="plan-hub-source"
                label="Таблица хаба"
                placeholder="Ссылка на Google-таблицу"
                value={link}
                onChange={(e) => {
                  setLink(e.target.value);
                  setSourceHint(null);
                }}
                autoComplete="off"
                className="min-w-0 flex-1"
                aria-invalid={sourceHint ? true : undefined}
                aria-describedby={sourceHint ? "plan-hub-source-error" : undefined}
              />
              <Button variant="secondary" onClick={() => void changeSource()} loading={sourceBusy} disabled={sourceBusy} className="sm:shrink-0" data-testid="plan-hub-source-save">
                Задать хаб
              </Button>
            </div>
            {sourceHint ? (
              <p id="plan-hub-source-error" role="alert" className="text-caption text-danger-ink">
                {sourceHint}
              </p>
            ) : null}
          </div>
        ) : null}
        {canSource ? (
          <div className="flex flex-col gap-2" data-testid="plan-hub-aliases">
            <TextArea
              id="plan-hub-aliases-text"
              label="Соответствие названий СК"
              rows={4}
              value={aliases}
              onChange={(e) => {
                setAliases(e.target.value);
                setAliasesSaved(false);
              }}
              placeholder={"Росгосстрах = РГС\nСбербанк страхование = СберСтрахование"}
              hint="По строке: название в «Все СК» = название в плане. Регистр, пробелы, кавычки, ё, дефисы и форма собственности (АО, ПАО, САО, СПАО, СК) и так не в счёт: сюда только разные написания одной СК"
            />
            {/* Кнопка появляется после правки (этап 59), как у «где сейчас»: выключенная серая читалась подписью */}
            {aliases !== savedAliases ? (
              <div>
                <Button variant="secondary" onClick={() => void saveAliases()} loading={aliasesBusy} disabled={aliasesBusy} data-testid="plan-hub-aliases-save">
                  Сохранить соответствие
                </Button>
              </div>
            ) : null}
            {aliasesSaved && aliases === savedAliases ? (
              <p className="text-caption text-success-ink" data-testid="plan-hub-aliases-saved">
                Соответствие сохранено
              </p>
            ) : null}
          </div>
        ) : null}
        {mode === "off" ? <p className="sv-alert sv-alert--warning">{source ? "Ключ служебного аккаунта Google не задан на сервере: хаб не прочитать." : "Хаб не задан: вставьте ссылку на таблицу «Единая воронка: данные»."}</p> : null}
        <FormError message={error ?? undefined} />
        {preview ? (
          <div className="flex flex-col gap-3" data-testid="plan-hub-preview">
            {preview.fact.ready && preview.plan.ready ? (
              <p className="sv-alert sv-alert--success">
                Всё читается. Снимок на {dmy(preview.day)} с фактом по {dmy(preview.factDay)}
                {preview.fact.info?.replaces ? " заменит сегодняшний" : ""}, план по СК заменит загруженный.
              </p>
            ) : preview.ready ? (
              <p className="sv-alert sv-alert--warning" data-testid="plan-hub-partial">
                {preview.fact.ready ? "Загрузится только снимок «Все СК»: план по СК не готов, загруженный план останется." : "Загрузится только план по СК: снимок «Все СК» не готов, прошлые снимки останутся."}
              </p>
            ) : (
              <p className="sv-alert sv-alert--danger" role="alert">
                Загрузить нельзя: обе части не готовы.
              </p>
            )}
            {preview.warnings.map((w) => (
              <p key={w} className="text-caption text-warning-ink" data-testid="plan-hub-warning">
                {w}
              </p>
            ))}
            <div className="grid gap-2 text-body sm:grid-cols-2">
              <HubPartCard
                title="«Все СК»: факт по СК"
                part={preview.fact}
                testId="plan-hub-fact"
                summary={preview.fact.info ? `Факт по ${dmy(preview.factDay)}. СК: ${preview.fact.info.companies}, полисов с начала месяца: ${n(preview.fact.info.policiesMtd)}. В снимок войдут: ${preview.fact.info.stored.map(monthLabel).join(", ") || "ничего"}` : null}
              />
              <HubPartCard
                title="План ОСАГО по СК"
                part={preview.plan}
                testId="plan-hub-plan"
                summary={preview.plan.info ? `СК: ${preview.plan.info.companies}, план полисов на месяц: ${n(preview.plan.info.planUnits)}, периодов: ${preview.plan.info.periods.length}` : null}
              />
            </div>
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}
