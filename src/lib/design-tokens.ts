// Токены оформления (этап 10): единый список имён для классов Tailwind, склейки классов и образца компонентов.
// Значения живут в src/app/globals.css (блок @theme), здесь только имена и размеры для проверки.
// Новый дизайн (этап 21) меняет значения в globals.css, экраны при этом не трогаются.

/** Размеры шрифта по ролям, px. Класс text-<имя> задаёт только размер, межстрочный интервал наследуется */
export const TEXT_SIZES = {
  micro: 11,
  tiny: 12,
  caption: 13,
  small: 14,
  body: 15,
  lead: 16,
  "title-sm": 17,
  title: 19,
  "title-lg": 20,
  "headline-sm": 22,
  headline: 24,
  page: 26,
  "headline-lg": 28,
  "page-lg": 30,
  "display-sm": 34,
  hero: 40,
  display: 44,
} as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** Тени: меню, окно, переключатель, уведомление, перетаскиваемая карточка, боковая панель */
export const SHADOWS = ["menu", "modal", "segment", "toast", "drag", "drawer"] as const;

/** Межстрочные интервалы сверх стандартных */
export const LEADINGS = ["hero"] as const;

/** Ширины контейнеров */
export const CONTAINERS = ["page"] as const;

/** Анимации появления */
export const ANIMATIONS = ["fade-in", "slide-in", "toast-in"] as const;
