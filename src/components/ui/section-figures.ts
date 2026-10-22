// Цифры разделов строкой под заголовком (этап 59, С3): Решения, Инициативы, Один на один переходят с плиток на
// строку, как на Задачах, Weekly и Целях. Правило ревизии: не больше трёх цифр, нули не показываются (это делает
// Figures с inline). Здесь только какие цифры и как подписаны: число стоит перед подписью, подпись склоняется

import { plural } from "@/domain/dates";
import type { Figure } from "./data";

/** Сколько цифр в строке раздела */
export const SECTION_FIGURES_MAX = 3;

/** Журнал решений: в силе, за неделю, без владельца; отменённые последними, их строка отрезает первыми */
export function decisionFigures(n: { active: number; cancelled: number; week: number; noOwner: number }): Figure[] {
  return [
    { label: "в силе", value: n.active, testId: "dec-fig-active" },
    { label: "за последние 7 дней", value: n.week, testId: "dec-fig-week" },
    { label: "без владельца", value: n.noOwner, tone: "warning", hint: "Решение в силе, но никто не отвечает за исполнение", testId: "dec-fig-noowner" },
    { label: "отменено", value: n.cancelled, testId: "dec-fig-cancelled" },
  ];
}

/**
 * Инициативы: открытые, тревожные, закрытые. «Ещё ищем» и «Уже делаем» не повторяются: их число стоит в заголовке
 * своей колонки
 */
export function initiativeFigures(n: { open: number; longSearch: number; stale: number; closed: number }): Figure[] {
  return [
    { label: "открыто", value: n.open, testId: "ini-fig-open" },
    { label: "долго ищут, как сделать", value: n.longSearch, tone: "warning", testId: "ini-fig-long" },
    { label: "без новостей 2 недели", value: n.stale, tone: "warning", testId: "ini-fig-stale" },
    { label: "закрыто", value: n.closed, testId: "ini-fig-closed" },
  ];
}

/** Один на один: собеседники, встречи без даты, темы в повестке; назначенные встречи последними */
export function oneOnOneFigures(n: { pairs: number; withNext: number; withoutNext: number; topics: number }): Figure[] {
  return [
    { label: plural(n.pairs, "собеседник", "собеседника", "собеседников"), value: n.pairs, testId: "oo-fig-pairs" },
    { label: "без назначенной встречи", value: n.withoutNext, tone: "warning", testId: "oo-fig-nonext" },
    { label: plural(n.topics, "тема в повестке", "темы в повестке", "тем в повестке"), value: n.topics, testId: "oo-fig-topics" },
    { label: plural(n.withNext, "встреча назначена", "встречи назначены", "встреч назначено"), value: n.withNext, testId: "oo-fig-next" },
  ];
}
