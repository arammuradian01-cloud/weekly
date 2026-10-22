import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BACK_TO_REPORTING_WEEK, weekTitle } from "@/domain/dates";
import { pickFigures } from "@/components/ui/data";
import { SECTION_FIGURES_MAX, decisionFigures, initiativeFigures, oneOnOneFigures } from "@/components/ui/section-figures";
import { STICKY_ZONE, stickyOffset } from "@/components/ui/sticky-bottom";

// Этап 59, шаг 1 плана правок дизайна: быстрые исправления текста и вида. Неделя одним форматом, цифры разделов
// строкой без нулей, тост над липкой панелью, человеческий текст плашки стенда, подсветка пункта меню с клавиатуры

const shown = (items: ReturnType<typeof decisionFigures>) => pickFigures(items, SECTION_FIGURES_MAX).map((f) => `${f.value} ${f.label}`);

describe("неделя одним форматом (С4)", () => {
  it("отчётная неделя «Неделя 43, отчётная», прошлая просто «Неделя 39», возврат действием, без «Текущая»", () => {
    expect(weekTitle(43, true)).toBe("Неделя 43, отчётная");
    expect(weekTitle(39, false)).toBe("Неделя 39");
    expect(BACK_TO_REPORTING_WEEK).toBe("К отчётной неделе");
    const feed = readFileSync("src/components/weekly/weekly-feed.tsx", "utf8");
    expect(feed).not.toMatch(/>\s*Текущая\s*</);
  });
});

describe("цифры разделов строкой (С3)", () => {
  it("решения: нули не показываются, не больше трёх, отменённые отрезаются первыми", () => {
    expect(shown(decisionFigures({ active: 3, cancelled: 0, week: 0, noOwner: 0 }))).toEqual(["3 в силе"]);
    expect(shown(decisionFigures({ active: 5, cancelled: 2, week: 1, noOwner: 1 }))).toEqual(["5 в силе", "1 за последние 7 дней", "1 без владельца"]);
    expect(shown(decisionFigures({ active: 0, cancelled: 2, week: 0, noOwner: 0 }))).toEqual(["2 отменено"]);
  });

  it("инициативы: колонки «Ещё ищем» и «Уже делаем» не повторяются, тревожные остаются при обрезке", () => {
    expect(shown(initiativeFigures({ open: 4, longSearch: 0, stale: 0, closed: 0 }))).toEqual(["4 открыто"]);
    expect(shown(initiativeFigures({ open: 4, longSearch: 1, stale: 2, closed: 3 }))).toEqual(["4 открыто", "1 долго ищут, как сделать", "2 без новостей 2 недели"]);
    expect(initiativeFigures({ open: 1, longSearch: 0, stale: 0, closed: 0 }).map((f) => f.label).join(" ")).not.toMatch(/Уже делаем|Ещё ищем/i);
  });

  it("один на один: собеседники склоняются, нули не показываются", () => {
    expect(shown(oneOnOneFigures({ pairs: 1, withNext: 1, withoutNext: 0, topics: 0 }))).toEqual(["1 собеседник", "1 встреча назначена"]);
    expect(shown(oneOnOneFigures({ pairs: 3, withNext: 1, withoutNext: 2, topics: 5 }))).toEqual(["3 собеседника", "2 без назначенной встречи", "5 тем в повестке"]);
  });

  it("на страницах Решений, Инициатив и Один на один цифры строкой, плиток больше нет", () => {
    for (const file of ["src/components/meeting/decisions-journal.tsx", "src/components/initiatives/initiatives-screen.tsx", "src/app/(app)/one-on-one/page.tsx"]) {
      const text = readFileSync(file, "utf8");
      const call = /<Figures[\s\S]*?\/>/.exec(text)![0];
      expect(call, file).toMatch(/\binline\b/);
      expect(call, file).toMatch(/max=\{SECTION_FIGURES_MAX\}/);
    }
    expect(readFileSync("src/components/ui/data.tsx", "utf8")).toMatch(/inline = true/);
  });
});

describe("тост над липкой панелью (С7)", () => {
  const vh = 900;
  it("панель у низа экрана поднимает тост до своего верхнего края", () => {
    // «Назад, Дальше» встречи на телефоне: 80 от низа, высота 69
    expect(stickyOffset([{ top: vh - 149, bottom: vh - 80, height: 69 }], vh)).toBe(149);
    // Две панели: берётся самая высокая
    expect(stickyOffset([{ top: vh - 69, bottom: vh, height: 69 }, { top: vh - 120, bottom: vh - 64, height: 56 }], vh)).toBe(120);
  });
  it("панель в середине страницы, ниже экрана или скрытая тост не двигает", () => {
    expect(stickyOffset([{ top: 300, bottom: 369, height: 69 }], vh)).toBe(0);
    expect(stickyOffset([{ top: vh + 10, bottom: vh + 79, height: 69 }], vh)).toBe(0);
    expect(stickyOffset([{ top: 0, bottom: 0, height: 0 }], vh)).toBe(0);
    expect(stickyOffset([{ top: vh - STICKY_ZONE - 69, bottom: vh - STICKY_ZONE, height: 69 }], vh)).toBe(STICKY_ZONE + 69);
    expect(stickyOffset([{ top: vh - STICKY_ZONE - 70, bottom: vh - STICKY_ZONE - 1, height: 69 }], vh)).toBe(0);
  });
  it("место тостов берёт переменную панели, тосты не стоят зашитым отступом", () => {
    const system = readFileSync("src/styles/ds/system/system.css", "utf8");
    expect(system).toMatch(/\.sv-toaster \{[^}]*bottom: max\(var\(--toast-base\), calc\(var\(--sticky-bottom\)/);
    const toaster = readFileSync("src/components/prototype/toaster.tsx", "utf8");
    expect(toaster).toMatch(/className="sv-toaster"/);
    expect(toaster).not.toMatch(/bottom-20|bottom-6/);
    for (const file of ["src/components/meeting/meeting-live.tsx", "src/components/weekly/meeting-mode.tsx", "src/components/tasks/bulk-actions.tsx"]) {
      expect(readFileSync(file, "utf8"), file).toMatch(/useStickyBottom\(/);
    }
  });
});

describe("тексты и вид оболочки (С5, С10, С12)", () => {
  it("плашка стенда без Bord и устройства ресурса, смена вида только владельцу", () => {
    const banner = readFileSync("src/components/prototype/banner.tsx", "utf8");
    const visible = banner.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(visible).not.toMatch(/Bord|базе ресурса|ничего в него не пишет/);
    expect(visible).toMatch(/canSwitch \?/);
    expect(readFileSync("src/app/(app)/layout.tsx", "utf8")).toMatch(/canSwitch=\{ctx\.person\.role === "OWNER"\}/);
  });

  it("ведущему разбора встречи не показываются имена переменных сервера", () => {
    for (const file of ["src/lib/meeting/parse-service.ts", "src/lib/meeting/claude.ts"]) {
      const strings = readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => /note = |new ClaudeError\(/.test(l))
        .join("\n");
      expect(strings, file).not.toMatch(/ANTHROPIC_[A-Z_]+/);
    }
  });

  it("пункт выпадающего меню под фокусом с клавиатуры: фон акцента и полоса цвета фокуса, не заливка поля", () => {
    const forms = readFileSync("src/styles/ds/forms/forms.css", "utf8");
    expect(forms).toMatch(/\.sv-menu__item:focus-visible[^{]*\{[^}]*background: var\(--color-accent-soft\);[^}]*box-shadow: inset 2px 0 0 var\(--color-focus\)/);
    for (const file of ["src/components/ui/overlays.tsx", "src/components/shell/profile-menu.tsx", "src/components/tasks/task-card.tsx", "src/components/discuss/reactions.tsx", "src/components/ui/importance.tsx", "src/components/inbox/inbox-list.tsx"]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/data-\[highlighted\]:bg-field/);
    }
  });

  it("«Новая задача» в шапке контурной кнопкой, неделя в шапке без рамки переключателя", () => {
    const top = readFileSync("src/components/shell/top-bar.tsx", "utf8");
    expect(top).toMatch(/sv-btn sv-btn--outline sv-btn--sm sv-topbar__new/);
    expect(top).not.toMatch(/sv-btn--dark/);
    expect(top).not.toMatch(/className="sv-week"/);
  });
});
