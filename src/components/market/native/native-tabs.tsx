// Вкладки новой версии раздела «Рынок» (этап 79): те же, что у дашборда из пакета, с теми же именами в адресе
// (?tab=overview, ?tab=o-insurers). Перенесённые вкладки считаются на сервере; остальные пока открываются в старой
// версии: на их месте «Скоро здесь» и ссылка на ту же вкладку старой версии.

export type MarketKind = "kasko" | "osago";
export type MarketTab = { id: string; label: string; market: MarketKind; native: boolean };

export const MARKET_TABS: MarketTab[] = [
  { id: "overview", label: "Обзор", market: "kasko", native: true },
  { id: "insurers", label: "Страховые", market: "kasko", native: false },
  { id: "regions", label: "Регионы", market: "kasko", native: false },
  { id: "cars", label: "Машины и цена", market: "kasko", native: false },
  { id: "sravni", label: "Сравни", market: "kasko", native: false },
  { id: "about", label: "О данных", market: "kasko", native: false },
  { id: "o-overview", label: "Обзор", market: "osago", native: true },
  { id: "o-insurers", label: "Страховые", market: "osago", native: false },
  { id: "o-sravni", label: "Сравни", market: "osago", native: false },
  { id: "o-about", label: "О данных", market: "osago", native: false },
];

export const tabOf = (id: string | null | undefined): MarketTab => MARKET_TABS.find((t) => t.id === id) ?? MARKET_TABS[0]!;

/** Адрес вкладки новой версии: срез регионов сохраняется */
export function nativeHref(tab: string, geo: string | null): string {
  const q = new URLSearchParams({ v: "2" });
  if (tab !== "overview") q.set("tab", tab);
  if (geo && geo !== "all") q.set("geo", geo);
  return `/market?${q.toString()}`;
}

/** Та же вкладка в старой версии */
export function oldHref(tab: string): string {
  return tab === "overview" ? "/market" : `/market?tab=${encodeURIComponent(tab)}`;
}
