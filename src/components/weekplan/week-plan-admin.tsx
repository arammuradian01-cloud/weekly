"use client";

// Неделя к плану (этап 81): загрузка плана из таблицы недель и чтение факта. Владелец и администраторы в режиме
// управления; источники меняет владелец. План грузится в два шага: проверить и загрузить

import { useState } from "react";
import { useRouter } from "next/navigation";
import { usePrototype } from "@/domain/store";
import { applyWeekPlanAction, previewWeekPlanAction, pullWeekFactAction, setWeekPlanSourcesAction } from "@/app/(app)/plan-fact/actions";
import type { PlanPreview, WeekPlanStatus } from "@/lib/weekplan/service";
import { dmy, num } from "@/lib/weekplan/format";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/overlays";
import { FormError } from "@/components/ui/field";
import { TextInput } from "@/components/ui/primitives";

const when = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso)) : "ещё не было";

export function WeekPlanAdmin({ status }: { status: WeekPlanStatus }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { notify } = usePrototype();
  const [busy, setBusy] = useState<null | "check" | "load" | "fact" | "src">(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanPreview | null>(null);
  const [plan, setPlan] = useState("");
  const [fact, setFact] = useState("");
  const [tab, setTab] = useState(status.sources.factTab);

  const check = async () => {
    setError(null);
    setPreview(null);
    setBusy("check");
    const r = await previewWeekPlanAction();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPreview(r.value);
  };
  const load = async () => {
    setError(null);
    setBusy("load");
    const r = await applyWeekPlanAction();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    notify(`План загружен: строк справочника ${r.value.lines}, строк плана ${r.value.rows.toLocaleString("ru-RU")}. ${r.value.fact.ok ? `Факт прочитан: ${r.value.fact.rows} строк` : `Факт не прочитан: ${r.value.fact.error}`}`);
    setPreview(null);
    setOpen(false);
    router.refresh();
  };
  const pull = async () => {
    setError(null);
    setBusy("fact");
    const r = await pullWeekFactAction();
    setBusy(null);
    if (!r.ok) return setError(r.error);
    notify(`Факт прочитан: ${r.value.rows} строк${r.value.latestWeek ? `, последняя неделя с ${dmy(r.value.latestWeek)}` : ""}`);
    router.refresh();
  };
  const saveSources = async () => {
    setError(null);
    setBusy("src");
    const r = await setWeekPlanSourcesAction({ plan, fact, factTab: tab });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setPlan("");
    setFact("");
    notify("Источники плана и факта сохранены");
    router.refresh();
  };

  const s = status;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} data-testid="weekplan-admin-open">
        План и факт
      </Button>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        wide
        title="План и факт по неделям"
        description="План из таблицы недель (справочник строк и «План для DWH»), факт раз в час из вкладки факта."
        footer={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => void check()} loading={busy === "check"} disabled={busy !== null} data-testid="weekplan-check">
              Проверить план
            </Button>
            <Button onClick={() => void load()} loading={busy === "load"} disabled={busy !== null || !preview?.ready} data-testid="weekplan-load">
              Загрузить план
            </Button>
            <Button variant="secondary" onClick={() => void pull()} loading={busy === "fact"} disabled={busy !== null || !s.plan} data-testid="weekplan-pull">
              Обновить факт
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4 py-4">
          <div className="flex flex-col gap-1 text-caption text-text-secondary" data-testid="weekplan-admin-status">
            <p>
              Таблица недель:{" "}
              <a href={`https://docs.google.com/spreadsheets/d/${s.sources.planId}/edit`} target="_blank" rel="noreferrer" className="font-semibold text-link underline-offset-2 hover:underline">
                открыть
              </a>
              . Факт: вкладка «{s.sources.factTab}»{s.sources.factId === s.sources.planId ? " той же таблицы" : " отдельной таблицы"}.
            </p>
            <p>{s.plan ? `План загружен ${when(s.plan.at)}, ${s.plan.by}: строк справочника ${s.plan.lines}, строк плана ${s.plan.rows.toLocaleString("ru-RU")}.` : "План ещё не загружен."}</p>
            <p>
              Факт прочитан {when(s.fact.lastOkAt)}
              {s.fact.ok === false ? `. Последняя попытка ${when(s.fact.lastAttemptAt)} не прошла: ${s.fact.error}` : ""}
              {s.fact.ok ? `: строк ${s.fact.rows}` : ""}.
            </p>
            {s.mode === "google" && s.serviceEmail ? <p>Служебному аккаунту {s.serviceEmail} нужно право «Читатель» на таблицу недель и таблицу факта.</p> : null}
          </div>
          {s.mode === "off" ? <p className="sv-alert sv-alert--warning">Ключ служебного аккаунта Google не задан на сервере: таблицу недель не прочитать.</p> : null}
          {s.fact.warnings.length ? (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-warning-ink" data-testid="weekplan-fact-warnings">
              {s.fact.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : null}
          <FormError message={error ?? undefined} />
          {preview ? (
            <div className="flex flex-col gap-2" data-testid="weekplan-preview">
              {preview.ready ? (
                <p className="sv-alert sv-alert--success">
                  План читается: строк справочника {preview.info?.lines}, строк плана {preview.info?.rows.toLocaleString("ru-RU")}, недель {preview.info?.weeks}
                  {preview.info?.first ? ` с ${dmy(preview.info.first)}` : ""}.{preview.info?.replaces ? " Заменит загруженный план." : ""}
                </p>
              ) : (
                <p className="sv-alert sv-alert--danger" role="alert">
                  Загрузить нельзя: {preview.problems[0]}
                </p>
              )}
              {preview.problems.slice(1).map((p) => (
                <p key={p} className="text-caption text-danger-ink">
                  {p}
                </p>
              ))}
              {preview.warnings.map((w) => (
                <p key={w} className="text-caption text-warning-ink">
                  {w}
                </p>
              ))}
              {preview.info?.sums.length ? (
                <div className="sv-table-scroll rounded-card border border-border">
                  <table className="sv-datatable" data-testid="weekplan-sums">
                    <caption className="sr-only">Контрольные суммы плана за все недели</caption>
                    <thead>
                      <tr>
                        <th scope="col">Контрольная сумма</th>
                        <th scope="col" className="is-num">
                          Бюджет
                        </th>
                        <th scope="col" className="is-num">
                          LRF
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.info.sums.map((x) => (
                        <tr key={x.label}>
                          <td className="is-wide">{x.label}</td>
                          <td className="is-num">{num(x.bud, x.unit)}</td>
                          <td className="is-num">{num(x.lrf, x.unit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          ) : null}
          {s.canSource ? (
            <details className="text-caption text-text-secondary" data-testid="weekplan-sources">
              <summary className="cursor-pointer rounded-tag py-1 font-semibold text-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Сменить источники</summary>
              <div className="mt-2 flex flex-col gap-2">
                <TextInput id="weekplan-src-plan" label="Таблица недель" placeholder="Ссылка; пусто: таблица по умолчанию" value={plan} onChange={(e) => setPlan(e.target.value)} autoComplete="off" />
                <TextInput id="weekplan-src-fact" label="Таблица факта" placeholder="Ссылка на таблицу факта из BI; пусто: таблица недель" value={fact} onChange={(e) => setFact(e.target.value)} autoComplete="off" />
                <TextInput id="weekplan-src-tab" label="Вкладка факта" placeholder="Факт Weekly для приложения или Факт по неделям" value={tab} onChange={(e) => setTab(e.target.value)} autoComplete="off" />
                <div>
                  <Button variant="secondary" onClick={() => void saveSources()} loading={busy === "src"} disabled={busy !== null} data-testid="weekplan-sources-save">
                    Сохранить источники
                  </Button>
                </div>
              </div>
            </details>
          ) : null}
        </div>
      </Drawer>
    </>
  );
}
