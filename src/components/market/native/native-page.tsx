// Новая версия раздела «Рынок» (этап 79): обычная серверная страница без окна с чужим кодом. Сервер берёт модель
// вкладки из памяти по отпечатку пакета (или считает её один раз) и отдаёт только её: плитки, тексты и небольшие ряды
// графиков. Доступ проверяет страница раздела до вызова.

import Link from "next/link";
import { cn } from "@/lib/cn";
import { Module } from "@/components/ui/data";
import { kaskoOverview, osagoOverview } from "@/lib/market/native/overview";
import { geoOf } from "@/lib/market/native/rows";
import { nativeModel } from "@/lib/market/native/store";
import type { MarketMeta } from "@/lib/market/service";
import type { MarketState } from "@/lib/market/params";
import { KaskoOverviewView, OsagoOverviewView } from "./overview-views";
import { MARKET_TABS, nativeHref, oldHref, tabOf, type MarketKind } from "./native-tabs";
import { Busy, MarketNav } from "./state";

export async function MarketNativePage({ meta, state }: { meta: MarketMeta; state: MarketState }) {
  const tab = tabOf(state.link);
  const geo = geoOf(state.params.geo);
  const params = state.params;
  let body: React.ReactNode;
  if (tab.id === "overview") {
    const model = await nativeModel(meta.stamp, `kasko-overview:${geo}`, (sets) => kaskoOverview(sets, geo));
    body = model ? <KaskoOverviewView model={model} params={params} /> : null;
  } else if (tab.id === "o-overview") {
    const model = await nativeModel(meta.stamp, "osago-overview", (sets) => osagoOverview(sets));
    body = model ? <OsagoOverviewView model={model} params={params} /> : null;
  } else {
    body = (
      <Module title="Скоро здесь" id="mk-soon">
        <div className="mk-soon" data-testid="market-soon">
          <p className="mk-note">Вкладку «{tab.label}» ещё переносим в новую версию. Пока она открывается в старой версии раздела.</p>
          <a href={oldHref(tab.id)} className="sv-btn sv-btn--outline sv-btn--sm" data-testid="market-soon-old">
            Открыть «{tab.label}» в старой версии
          </a>
        </div>
      </Module>
    );
  }
  const market: MarketKind = tab.market;
  return (
    <MarketNav>
      <div className="mk" data-testid="market-native">
        <div className="flex flex-col gap-1">
          <nav aria-label="Рынок" className="sv-segment max-w-full self-start" data-testid="market-kind">
            {(["kasko", "osago"] as MarketKind[]).map((k) => (
              <Link key={k} href={nativeHref(k === "kasko" ? "overview" : "o-overview", geo)} className={cn("sv-segment__item", market === k && "is-active")} aria-current={market === k ? "page" : undefined}>
                {k === "kasko" ? "КАСКО" : "ОСАГО"}
              </Link>
            ))}
          </nav>
          <nav className="sv-tabs" aria-label={market === "kasko" ? "Разделы КАСКО" : "Разделы ОСАГО"} data-testid="market-tabs">
            {MARKET_TABS.filter((t) => t.market === market).map((t) => (
              <Link key={t.id} href={nativeHref(t.id, geo)} className={cn("sv-tabs__item max-sm:h-11", t.id === tab.id && "is-active")} aria-current={t.id === tab.id ? "page" : undefined}>
                {t.label}
              </Link>
            ))}
          </nav>
        </div>
        <Busy>{body}</Busy>
      </div>
    </MarketNav>
  );
}
