// Оформление окна дашборда рынка (этап 62). Окно изолировано и не видит стили приложения, поэтому токены, которые ждёт
// код дашборда (--color-*, --cds-*, --font-anthropic-*), задаются здесь значениями из src/styles/tokens.css: светлая
// и тёмная тема. Тема приходит из приложения атрибутом data-theme, без него берётся настройка устройства.
// Шрифт системный: файлы шрифтов в окно не грузятся.

/** Категориальная палитра графиков дашборда: первые два цвета как ряды графиков приложения (--color-chart-1, -2) */
export const MARKET_PALETTES = {
  light: ["#0073A8", "#139A43", "#C26A00", "#5047D7", "#0F7F80", "#B5306B", "#7A6A2E", "#636F7D"],
  dark: ["#1A8FD0", "#12A845", "#F29B38", "#9C95F5", "#2BB3B3", "#E36E9F", "#C2B072", "#9198A1"],
} as const;

export type MarketTheme = keyof typeof MARKET_PALETTES;

const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

const LIGHT = `
  color-scheme: light;
  --color-bg: #F6F5F4;
  --color-panel: #FFFFFF;
  --color-fg: #171D23;
  --color-fg-muted: #636F7D;
  --color-border-line: #DADDE2;
  --color-ok: #11693F;
  --color-bad: #C11D1D;
  --cds-border: #DADDE2;
  --cds-text-secondary: #636F7D;
  --cds-surface-popover: #FFFFFF;
  --cds-shadow-popover: 0 12px 16px rgba(0, 0, 0, 0.06);
  --cds-chart-axis: #7E8894;
  --cds-chart-grid: #DADDE2;
  --cds-chart-muted: #B3BAC3;
  --cds-chart-reference: #7E8894;
  --cds-chart-status-critical: #C11D1D;
  --market-focus: #0073A8;`;

const DARK = `
  color-scheme: dark;
  --color-bg: #080A0C;
  --color-panel: #171D23;
  --color-fg: #FFFFFF;
  --color-fg-muted: #9198A1;
  --color-border-line: #4E5764;
  --color-ok: #9EEDB6;
  --color-bad: #F1B2B2;
  --cds-border: #4E5764;
  --cds-text-secondary: #9198A1;
  --cds-surface-popover: #2B2E33;
  --cds-shadow-popover: 0 12px 16px rgba(0, 0, 0, 0.35);
  --cds-chart-axis: #9198A1;
  --cds-chart-grid: #4E5764;
  --cds-chart-muted: #78808C;
  --cds-chart-reference: #9198A1;
  --cds-chart-status-critical: #F28B8B;
  --market-focus: #00AFFF;`;

/** Стили окна: токены двух тем, размеры и отступы, заготовка загрузки, спрятанный блок обновления данных */
export const MARKET_THEME_CSS = `
:root {${LIGHT}
  --font-anthropic-sans: ${SYSTEM_FONT};
  --font-anthropic-serif: ${SYSTEM_FONT};
  --cds-gap-xs: 4px;
  --cds-gap-sm: 8px;
  --cds-gap-md: 12px;
  --cds-gap-lg: 24px;
  --cds-pad-xs: 4px;
  --cds-pad-sm: 8px;
  --cds-pad-md: 12px;
  --cds-pad-lg: 16px;
  --cds-font-size-caption: 12px;
  --cds-font-size-body: 14px;
  --cds-font-size-heading: 16px;
  --cds-font-size-title: 22px;
  --cds-font-weight-medium: 600;
  --cds-radius: 12px;
  --cds-dur-slow: 300ms;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK}
  }
}
:root[data-theme="dark"] {${DARK}
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--color-bg); color: var(--color-fg); }
body { font-family: var(--font-anthropic-sans); font-size: 14px; line-height: 1.45; -webkit-text-size-adjust: 100%; overflow-x: hidden; }
#dash-root { padding: 4px; }
:focus-visible { outline-color: var(--market-focus); }
.kx-title, .kx-tv { font-weight: 700; }
.dash-skeleton { color: transparent !important; border-radius: 6px; background: linear-gradient(90deg, var(--color-border-line) 0%, var(--color-panel) 50%, var(--color-border-line) 100%); background-size: 200% 100%; animation: dash-shimmer 1.2s ease-in-out infinite; }
@keyframes dash-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
@media (prefers-reduced-motion: reduce) { .dash-skeleton { animation: none; } }
/* Данные рынка обновляются загрузкой пакета в приложении: блок обновления внутри дашборда не нужен */
#c-import, #go-imp, [data-market-hide] { display: none !important; }
`;
