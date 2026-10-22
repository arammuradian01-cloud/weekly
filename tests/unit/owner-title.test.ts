// Этап 69: подпись роли владельца. Проверка текста подписи, чтение настройки и правило по умолчанию: главный
// «Владелец», остальные «Совладелец», своя подпись важнее, у не владельцев подпись не действует.
import { describe, expect, it } from "vitest";
import { checkOwnerTitle, OWNER_TITLE_TEXTS, ownerTitlesFrom } from "@/lib/owner-title";
import { personRoleLabel, roleLabelOf, type OwnerLabels } from "@/lib/roles";

describe("текст подписи роли", () => {
  it("ex-Владелец и Владелец проходят как есть, пробелы по краям обрезаны, подряд идущие склеены", () => {
    expect(checkOwnerTitle("ex-Владелец")).toEqual({ ok: true, title: "ex-Владелец" });
    expect(checkOwnerTitle("  Владелец ")).toEqual({ ok: true, title: "Владелец" });
    expect(checkOwnerTitle("Генеральный   директор")).toEqual({ ok: true, title: "Генеральный директор" });
    expect(checkOwnerTitle("CEO, владелец (ресурс)")).toEqual({ ok: true, title: "CEO, владелец (ресурс)" });
    expect(checkOwnerTitle("Владелец 2")).toEqual({ ok: true, title: "Владелец 2" });
  });

  it("пустая подпись: подписи нет, действует правило по умолчанию", () => {
    for (const empty of ["", "   ", null, undefined]) expect(checkOwnerTitle(empty)).toEqual({ ok: true, title: null });
  });

  it("длинное и среднее тире становятся дефисом, как в остальных полях ресурса", () => {
    expect(checkOwnerTitle("ex—Владелец")).toEqual({ ok: true, title: "ex-Владелец" });
    expect(checkOwnerTitle("ex–Владелец")).toEqual({ ok: true, title: "ex-Владелец" });
  });

  it("от 2 до 30 знаков после обрезки", () => {
    expect(checkOwnerTitle("В")).toEqual({ ok: false, error: OWNER_TITLE_TEXTS.length });
    expect(checkOwnerTitle("Вл")).toEqual({ ok: true, title: "Вл" });
    expect(checkOwnerTitle("В".repeat(30))).toEqual({ ok: true, title: "В".repeat(30) });
    expect(checkOwnerTitle("В".repeat(31))).toEqual({ ok: false, error: OWNER_TITLE_TEXTS.length });
    expect(checkOwnerTitle(`  ${"В".repeat(30)}  `)).toEqual({ ok: true, title: "В".repeat(30) });
  });

  it("стрелки, точка посередине, кавычки, значки и переводы строк внутри не проходят", () => {
    for (const bad of ["Владелец → CEO", "Владелец · CEO", "«Владелец»", "Владелец!", "Владелец \u{1F451}", "Владелец/CEO", "Владелец & Co", "<b>Владелец</b>"]) {
      expect(checkOwnerTitle(bad), bad).toEqual({ ok: false, error: OWNER_TITLE_TEXTS.chars });
    }
    // Перевод строки внутри склеивается в пробел, как любые пробелы подряд
    expect(checkOwnerTitle("Владелец\nресурса")).toEqual({ ok: true, title: "Владелец ресурса" });
  });

  it("нужна хотя бы одна буква", () => {
    expect(checkOwnerTitle("12")).toEqual({ ok: false, error: OWNER_TITLE_TEXTS.letter });
    expect(checkOwnerTitle("--")).toEqual({ ok: false, error: OWNER_TITLE_TEXTS.letter });
  });

  it("тексты отказов по правилам текста проекта: без длинного тире, стрелок и точки посередине", () => {
    for (const t of Object.values(OWNER_TITLE_TEXTS)) expect(t).not.toMatch(/[—→·]/);
  });
});

describe("подписи из настройки", () => {
  it("берутся только строки, которые проходят проверку; сломанное значение даёт пустой список", () => {
    expect(ownerTitlesFrom({ muradyan: "ex-Владелец", ceo: " Владелец ", bad: "→", num: 5, empty: "" })).toEqual({ muradyan: "ex-Владелец", ceo: "Владелец" });
    for (const broken of [null, undefined, "ex-Владелец", 42, ["ex-Владелец"]]) expect(ownerTitlesFrom(broken)).toEqual({});
  });
});

describe("подпись роли на экранах", () => {
  const owners: OwnerLabels = { primary: "muradyan", titles: { muradyan: "ex-Владелец", krainik: "Владелец" } };

  it("без подписи прежнее правило: главный «Владелец», остальные владельцы «Совладелец»", () => {
    expect(personRoleLabel("OWNER", true)).toBe("Владелец");
    expect(personRoleLabel("OWNER", false)).toBe("Совладелец");
    expect(personRoleLabel("OWNER", false, "  ")).toBe("Совладелец");
    expect(personRoleLabel("ADMIN", false)).toBe("Администратор");
    expect(roleLabelOf({ slug: "golovkin", role: "OWNER" }, owners)).toBe("Совладелец");
    expect(roleLabelOf({ slug: "muradyan", role: "OWNER" }, { primary: "muradyan", titles: {} })).toBe("Владелец");
  });

  it("своя подпись важнее правила: главному «ex-Владелец», совладельцу «Владелец»", () => {
    expect(roleLabelOf({ slug: "muradyan", role: "OWNER" }, owners)).toBe("ex-Владелец");
    expect(roleLabelOf({ slug: "krainik", role: "OWNER" }, owners)).toBe("Владелец");
    expect(personRoleLabel("OWNER", false, "Владелец")).toBe("Владелец");
  });

  it("подпись действует только у владельца: без роли владельца человек подписан своей ролью", () => {
    expect(roleLabelOf({ slug: "krainik", role: "OBSERVER" }, owners)).toBe("Наблюдатель");
    expect(roleLabelOf({ slug: "muradyan", role: "ADMIN" }, owners)).toBe("Администратор");
    expect(personRoleLabel("LEADER", false, "ex-Владелец")).toBe("Лидер");
  });
});
