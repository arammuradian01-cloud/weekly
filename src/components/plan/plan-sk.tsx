"use client";

// ОСАГО по СК в карточке продукта (этап 58): план месяца из модели по СК, факт с начала месяца по снимку «Все СК» из хаба
// (факт по вчерашний день), ранрейт до конца месяца и прогноз к плану. Выручка (с апсейлом) и КВ по СК показываются только
// управлению и командам ОСАГО и партнёрского канала при личном входе: остальным колонок нет вовсе, не пустые ячейки

import type { SkRow, SkView } from "@/lib/plan/hub-service";
import { formatPlan } from "@/lib/plan/format";
import { Delta } from "@/components/ui/data";
import { delta, when } from "./plan-ui";

const int = (v: number | null) => (v === null ? "нет" : Math.round(v).toLocaleString("ru-RU"));
const pct = (v: number | null, digits = 0) => (v === null ? "нет" : `${(v * 100).toLocaleString("ru-RU", { maximumFractionDigits: digits, minimumFractionDigits: digits })}%`);
const dayText = (day: string) => `${Number(day.slice(8, 10))}.${day.slice(5, 7)}`;

function Row({ r, sensitive, total }: { r: SkRow; sensitive: boolean; total?: boolean }) {
  return (
    <tr className={total ? "sv-datatable__row--total font-semibold" : undefined} data-testid={total ? "plan-sk-total" : "plan-sk-row"}>
      <td className="is-wide">
        <div className="sv-datatable__name">
          <span>{r.sk}</span>
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
      <td className="is-num" data-label="Ранрейт">
        {int(r.forecast)}
      </td>
      <td className="is-num" data-label="К плану">
        <Delta value={delta(r.forecast, r.plan, "count")} label={`${r.sk}: прогноз к плану`} />
      </td>
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
  return (
    <section className="sv-plan-facts" aria-labelledby="plan-sk-title" data-testid="plan-sk">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h4 id="plan-sk-title" className="text-body font-semibold text-ink">
          ОСАГО по СК: план, факт и ранрейт
        </h4>
        <p className="text-caption text-text-secondary" data-testid="plan-sk-asof">
          {sk.factTomorrow ? "Факт за месяц появится завтра" : sk.day ? `Факт «Все СК» по ${dayText(sk.day)}${sk.loadDay ? ` (снимок ${dayText(sk.loadDay)})` : ""}, день ${sk.elapsed} из ${sk.days}` : "Снимков «Все СК» за месяц нет"}
          {sk.source.pulledAt ? `. Загружено ${when(sk.source.pulledAt)}${sk.source.pulledBy ? `, ${sk.source.pulledBy}` : ""}` : ""}
        </p>
      </div>
      {sk.factTomorrow ? (
        <p className="sv-alert sv-alert--info" data-testid="plan-sk-tomorrow">
          Факт за месяц появится завтра: в «Все СК» факт по вчерашний день, сегодняшний снимок закрывает прошлый месяц. Ранрейт пока не считается, в таблице план месяца.
        </p>
      ) : null}
      {sk.stale ? (
        <p className="sv-alert sv-alert--warning" data-testid="plan-sk-stale">
          Снимок старше вчерашнего: факт с начала месяца отстаёт. Загрузите хаб, чтобы ранрейт считался по свежим цифрам.
        </p>
      ) : null}
      {!sk.factTomorrow && sk.profileDays < 14 ? (
        <p className="text-caption text-text-secondary" data-testid="plan-sk-method">
          Прогноз линейный по дням. Профиль дней недели включится, когда дневных снимков подряд будет 14, сейчас {sk.profileDays}.
        </p>
      ) : null}
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="sv-datatable sv-datatable--stack" data-testid="plan-sk-table">
          <caption className="sr-only">ОСАГО по страховым компаниям: план месяца, факт с начала месяца, ранрейт и прогноз к плану</caption>
          <thead>
            <tr>
              <th scope="col">СК</th>
              <th scope="col" className="is-num">
                План, полисы
              </th>
              <th scope="col" className="is-num">
                Факт с начала месяца
              </th>
              <th scope="col" className="is-num">
                Доля пула
              </th>
              <th scope="col" className="is-num">
                Ранрейт месяца
              </th>
              <th scope="col" className="is-num">
                К плану
              </th>
              {sk.sensitive ? (
                <>
                  <th scope="col" className="is-num">
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
              <Row key={r.sk} r={r} sensitive={sk.sensitive} />
            ))}
            <Row r={sk.total} sensitive={sk.sensitive} total />
          </tbody>
        </table>
      </div>
      <p className="text-caption text-text-secondary" data-testid="plan-sk-lbe">
        {sk.lbeUnits !== null && sk.total.forecast !== null
          ? `Итог ранрейта ${int(sk.total.forecast)} против LBE полисов ОСАГО ${int(sk.lbeUnits)}: ${pct(vs)}. План по СК в таблице из модели бюджета, LBE из LRF: это разные версии, расхождение между ними нормально`
          : "LBE полисов ОСАГО на месяц не загружен, итог ранрейта сравнить не с чем"}
      </p>
    </section>
  );
}
