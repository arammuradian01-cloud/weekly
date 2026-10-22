// Конкуренты для блока «Конкуренты» weekly для CEO (этап 66). Список с ключевыми словами ведёт владелец на странице
// «Отчёт CEO», в базе настройка ceo.competitors. Слова ищутся так же, как ключевые слова новостей (этап 60): по началу
// слова, в словосочетании каждое слово по началу, в кавычках только целиком. Стартовый список ниже: предложение, его
// подтверждает Арам (README, раздел «Weekly по смысловым блокам (этап 66)»).
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
  // Т-Банк как агрегатор страхования, а не банк целиком: «Т-Банк» без страхования дал бы все новости банка
  { name: "Т-Банк (агрегатор страхования)", keywords: ["Т-Страхован", "Т-Банк Страхован", "Тинькофф Страхован"] },
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
    // Без своих слов конкурент ищется по имени
    out.push({ name, keywords: keywords.length ? keywords : normalizeKeywords([name]) });
    if (out.length >= COMPETITOR_LIMITS.count) break;
  }
  return out;
}

/** Настройка из базы: нет настройки, стартовый список */
export function competitorsOf(value: unknown): Competitor[] {
  return Array.isArray(value) ? cleanCompetitors(value) : DEFAULT_COMPETITORS.map((c) => ({ ...c, keywords: [...c.keywords] }));
}
