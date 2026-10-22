"use client";

// ОСАГО по СК в карточке продукта (этап 58): план месяца из модели по СК, факт с начала месяца по снимку «Все СК» из хаба
// (факт по вчерашний день), ранрейт до конца месяца и прогноз к плану. Выручка (с апсейлом) и КВ по СК показываются только
// управлению и командам ОСАГО и партнёрского канала при личном входе: остальным колонок нет вовсе, не пустые ячейки.
// Ранрейт и «К плану» появляются, когда в месяце набирается HUB_LIMITS.minRunRateDays дней факта: до этого колонок нет

import type { SkRow, SkView } from "@/lib/plan/hub-service";
import { HUB_LIMITS } from "@/lib/plan/hub";
import { formatPlan } from "@/lib/plan/format";
import { Delta } from "@/components/ui/data";
import { delta, when } from "./plan-ui";

const int = (v: number | null) => (v === null ? "нет" : Math.round(v).toLocaleString("ru-RU"));
const pct = (v: number | null, digits = 0) => (v === null ? "нет" : `${(v * 100).toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`);
const dayText = (day: string) => `${Number(day.slice(8, 10))}.${day.slice(5, 7)}`;
const loaded = (what: string, part: { at: string; by: string } | null) => (part ? `${what} загружен ${when(part.at)}${part.by ? `, ${part.by}` : ""}` : `${what} не загружен`);

function Row({ r, sensitive, rate, total }: { r: SkRow; sensitive: boolean; rate: boolean; total?: boolean }) {
  return (
    <tr className={total ? "sv-datatable__row--total font-semibold" : undefined} data-testid={total ? "plan-sk-total" : "plan-sk-row"}>
      <td className="is-wide">
        <div className="sv-datatable__name">
          <span>{r.sk}</span>
          {r.carriedFrom ? (
            <span className="sv-datatable__hint text-warning-ink" data-testid="plan-sk-carried">
              Нет в последнем снимке: факт на {dayText(r.carriedFrom)}
            </span>
          ) : null}
          {r.unstable ? <span className="sv-datatable__hint text-warning-ink">Темп неровный: линейно {int(r.linear)}, по дням недели {int(r.profile)}</span> : null}
        </div>
      </td>
      <td className="is-num" data-label="План">
        {int(r.plan)}
      </td>
      <td className="is-num" data-label="Факт">
        {int(r.mtd)}
      </td>
      <td className="is-num" data-label="Пул">
        {pct(r.poolShare)}
      </td>
      {rate ? (
        <>
          <td className="is-num" data-label="Ранрейт" data-testid="plan-sk-forecast">
            {int(r.forecast)}
          </td>
          <td className="is-num" data-label="К плану">
            <Delta value={delta(r.forecast, r.plan, "count")} label={`${r.sk}: прогноз к плану`} />
          </td>
        </>
      ) : null}
      {sensitive ? (
        <>
          <td className="is-num" data-label="Выручка с апсейлом, млн" data-testid="plan-sk-revenue">
            {r.revenueMtd === null ? "нет" : formatPlan(r.revenueMtd, "mln")}
          </td>
          <td className="is-num" data-label="КВ" data-testid="plan-sk-kv">
            {pct(r.kvPlan, 1)}
          </td>
        </>
      ) : null}
    </tr>
  );
}

export function PlanSk({ sk }: { sk: SkView }) {
  const vs = sk.total.forecast !== null && sk.lbeUnits ? sk.total.forecast / sk.lbeUnits : null;
  // Ранрейт есть, когда есть факт за месяц и дней факта хватает
  const rate = !sk.factTomorrow && sk.day !== null && sk.runRateFrom === null;
  return (
    <section className="sv-plan-facts" aria-labelledby="plan-sk-title" data-testid="plan-sk">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 id="plan-sk-title" className="text-body font-semibold text-ink">
          ОСАГО по СК: план, факт и ранрейт
        </h4>
        <p className="text-caption text-text-secondary" data-testid="plan-sk-asof">
          {sk.factTomorrow ? "Факт за месяц появится завтра" : sk.day ? `Факт «Все СК» по ${dayText(sk.day)}${sk.loadDay ? ` (снимок ${dayText(sk.loadDay)})` : ""}, день ${sk.elapsed} из ${sk.days}` : "Снимков «Все СК» за месяц нет"}
        </p>
      </div>
      <p className="text-caption text-text-secondary" data-testid="plan-sk-loaded">
        {loaded("Факт", sk.source.fact)}. {loaded("План", sk.source.plan)}.
      </p>
      {sk.factTomorrow ? (
        <p className="sv-alert sv-alert--info" data-testid="plan-sk-tomorrow">
          Факт за месяц появится завтра: в «Все СК» факт по вчерашний день, сегодняшний снимок закрывает прошлый месяц. Ранрейт пока не считается, в таблице план месяца.
        </p>
      ) : null}
      {sk.runRateFrom !== null ? (
        <p className="sv-alert sv-alert--info" data-testid="plan-sk-early">
          Ранрейт и отклонение от плана появятся с {sk.runRateFrom}-го числа: по одному-двум дням факта месяц не прогнозируется. Нужно {HUB_LIMITS.minRunRateDays} дня факта, сейчас {sk.elapsed}.
        </p>
      ) : null}
      {sk.stale ? (
        <p className="sv-alert sv-alert--warning" data-testid="plan-sk-stale">
          Снимок старше вчерашнего: факт с начала месяца отстаёт. Загрузите хаб, чтобы ранрейт считался по свежим цифрам.
        </p>
      ) : null}
      {rate && sk.profileDays < HUB_LIMITS.minProfileDays ? (
        <p className="text-caption text-text-secondary" data-testid="plan-sk-method">
          Прогноз линейный по дням. Профиль дней недели включится, когда в месяце наберётся {HUB_LIMITS.minProfileDays} дней с дневным фактом (есть снимок за день и за предыдущий день), сейчас {sk.profileDays}.
        </p>
      ) : null}
      {/* Таблица по СК широкая (этап 59): прокручивается вбок внутри своего контейнера, колонка СК закреплена. На телефоне
          тоже таблица, а не карточки: СК сравниваются между собой по строкам */}
      <div className="sv-table-scroll rounded-card border border-border" tabIndex={0} role="region" aria-label="Таблица ОСАГО по СК" data-testid="plan-sk-scroll">
        <table className="sv-datatable sv-datatable--sticky-first" data-testid="plan-sk-table">
          <caption className="sr-only">ОСАГО по страховым компаниям: план месяца, факт с начала месяца{rate ? ", ранрейт и прогноз к плану" : ""}</caption>
          <thead>
            <tr>
              <th scope="col">СК</th>
              <th scope="col" className="is-num">
                План, полисы
              </th>
              <th scope="col" className="is-num whitespace-normal py-1.5">
                Факт с начала месяца
              </th>
              <th scope="col" className="is-num">
                Доля пула
              </th>
              {rate ? (
                <>
                  <th scope="col" className="is-num">
                    Ранрейт месяца
                  </th>
                  <th scope="col" className="is-num">
                    К плану
                  </th>
                </>
              ) : null}
              {sk.sensitive ? (
                <>
                  <th scope="col" className="is-num whitespace-normal py-1.5">
                    Выручка с апсейлом с начала месяца, млн
                  </th>
                  <th scope="col" className="is-num">
                    КВ плана
                  </th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sk.rows.map((r) => (
              <Row key={r.sk} r={r} sensitive={sk.sensitive} rate={rate} />
            ))}
            <Row r={sk.total} sensitive={sk.sensitive} rate={rate} total />
          </tbody>
        </table>
      </div>
      <p className="text-caption text-text-secondary" data-testid="plan-sk-lbe">
        {sk.lbeUnits === null
          ? "LBE полисов ОСАГО на месяц не загружен, итог ранрейта сравнить не с чем"
          : sk.total.forecast !== null
            ? `Итог ранрейта ${int(sk.total.forecast)} против LBE полисов ОСАГО ${int(sk.lbeUnits)}: ${pct(vs)}. План по СК в таблице из модели бюджета, LBE из LRF: это разные версии, расхождение между ними нормально`
            : `LBE полисов ОСАГО на месяц ${int(sk.lbeUnits)}. Итог ранрейта сравнится с ним, когда появится ранрейт`}
      </p>
    </section>
  );
}
