// Конкуренты для блока «Конкуренты» weekly для CEO (этап 66). Список с ключевыми словами ведёт владелец на странице
// «Отчёт CEO», в базе настройка ceo.competitors. Слова ищутся так же, как ключевые слова новостей (этап 60): по началу
// слова, в словосочетании каждое слово по началу, в кавычках только целиком. Ещё два вида слов: «A + B» (оба слова в
// одной фразе) и минус-слово «-X» (такое слово в тексте не считается). Имя самой ленты признаком не считается: новости
// ленты Банки.ру не становятся новостями о Банки.ру. Стартовый список ниже подтвердил Арам 22.10.
//
// Ограничение модуля новостей: в базе лежат только новости, которые привязались к продуктам по их словам. Новость о
// конкуренте без слов продуктов («Пампаду привлёк инвестиции») в ресурс не попадает и в блок тоже.

import { normalizeKeywords } from "@/lib/news/keywords";
import { tidy } from "./types";
import type { Competitor } from "./assemble";

export const COMPETITORS_KEY = "ceo.competitors";
export const COMPETITOR_LIMITS = { count: 20, name: 60, keywords: 20 } as const;

export const DEFAULT_COMPETITORS: Competitor[] = [
  { name: "Банки.ру", keywords: ["Банки.ру", "banki.ru"] },
  // «Выберу» без «.ру» это ещё и глагол: только целым названием
  { name: "Выберу.ру", keywords: ['"Выберу.ру"', "vbr.ru"] },
  { name: "Пампаду", keywords: ["Пампаду", "Pampadu"] },
  // Т-Банк как агрегатор и сервис сравнения страховок, а не банк целиком и не страховщик «Т-Страхование» (бывшее
  // «Тинькофф Страхование»): «Т-Банк» рядом с агрегатором или сравнением в одной фразе, страховщик минус-словом
  { name: "Т-Банк (агрегатор страхования)", keywords: ["Т-Банк + агрегатор", "Т-Банк + сравнен", "Т-Банк + маркетплейс", "Тинькофф + агрегатор", "Тинькофф + сравнен", "-Т-Страхован", "-Тинькофф Страхован"] },
  { name: "Инсапп", keywords: ["Инсапп", "Insapp"] },
  { name: "Cherehapa", keywords: ["Черехап", "Cherehapa"] },
  { name: "Финуслуги", keywords: ["Финуслуг"] },
];

/** Список из формы или базы: имя и слова, без пустых и повторов, в пределах лимитов */
export function cleanCompetitors(input: unknown): Competitor[] {
  if (!Array.isArray(input)) return [];
  const out: Competitor[] = [];
  const seen = new Set<string>();
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = tidy(r.name, COMPETITOR_LIMITS.name);
    const list = Array.isArray(r.keywords) ? r.keywords : typeof r.keywords === "string" ? r.keywords.split(/[,;\n]/) : [];
    const keywords = normalizeKeywords(list).slice(0, COMPETITOR_LIMITS.keywords);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    // Без своих слов (или только с минус-словами) конкурент ищется и по имени
    out.push({ name, keywords: keywords.some((k) => !k.startsWith("-")) ? keywords : [...normalizeKeywords([name]), ...keywords] });
    if (out.length >= COMPETITOR_LIMITS.count) break;
  }
  return out;
}

/** Настройка из базы: нет настройки, стартовый список */
export function competitorsOf(value: unknown): Competitor[] {
  return Array.isArray(value) ? cleanCompetitors(value) : DEFAULT_COMPETITORS.map((c) => ({ ...c, keywords: [...c.keywords] }));
}
