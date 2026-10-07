// Токены оформления (этап 10, обновлено на этапе 18): единый список имён для классов Tailwind, склейки классов
// и образца компонентов. Значения живут в src/styles/tokens.css (дизайн-система «Сравни: внутренние продукты»),
// Tailwind берёт их через src/app/globals.css (@theme inline), поэтому тема и масштаб переключаются атрибутами.

/**
 * Роли шрифта. Размер и межстрочный интервал задаются вместе: класс text-<имя> даёт оба.
 * Старые имена этапа 10 сведены к девяти ролям дизайн-системы (guidelines/tokens-table.md), значения для ноутбука
 */
export const TEXT_SIZES = {
  micro: 12,
  tiny: 12,
  caption: 12,
  "table-head": 12,
  small: 14,
  body: 14,
  lead: 16,
  card: 16,
  "title-sm": 16,
  title: 22,
  "title-lg": 22,
  section: 22,
  "headline-sm": 22,
  headline: 28,
  page: 28,
  "headline-lg": 28,
  "page-lg": 28,
  "display-sm": 28,
  number: 28,
  hero: 28,
  display: 28,
} as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** Роли дизайн-системы и какие старые имена к ним сведены */
export const TEXT_ROLES: Record<string, { role: string; leading: number }> = {
  caption: { role: "caption", leading: 16 },
  "table-head": { role: "table-head", leading: 16 },
  small: { role: "small", leading: 20 },
  body: { role: "body", leading: 20 },
  lead: { role: "lead", leading: 20 },
  card: { role: "card", leading: 20 },
  section: { role: "section", leading: 26 },
  page: { role: "page", leading: 32 },
  number: { role: "number", leading: 32 },
};

/** Тени: три уровня дизайн-системы и старые имена, сведённые к ним */
export const SHADOWS = ["small", "medium", "sticky", "menu", "modal", "segment", "toast", "drag", "drawer"] as const;

/** Межстрочные интервалы сверх стандартных: пусто, межстрочный идёт вместе с ролью шрифта */
export const LEADINGS = [] as const;

/** Ширины контейнеров */
export const CONTAINERS = ["page"] as const;

/** Анимации появления */
export const ANIMATIONS = ["fade-in", "slide-in", "toast-in"] as const;

/** Радиусы дизайн-системы: кнопки и поля, крупные кнопки, карточки, панели, теги, пилюли */
export const RADII = ["control", "control-lg", "card", "panel", "tag", "pill"] as const;
