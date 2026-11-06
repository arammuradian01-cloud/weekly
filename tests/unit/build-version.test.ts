import { describe, expect, it } from "vitest";
import { UNKNOWN_VERSION, buildVersionFrom } from "@/lib/build-version";

// Этап 86: какая версия собрана, для страницы «Состояние»

describe("версия сборки", () => {
  it("сначала подпись владельца из переменных", () => {
    expect(buildVersionFrom({ APP_VERSION: "этап 86", BUILD_SHA: "abcdef1234567890" }, "build-id")).toBe("этап 86");
  });

  it("потом отпечаток коммита, обрезанный до 12 знаков", () => {
    expect(buildVersionFrom({ BUILD_SHA: "abcdef1234567890" }, "build-id")).toBe("abcdef123456");
  });

  it("потом отпечаток сборки Next: он меняется сам с каждой сборкой", () => {
    expect(buildVersionFrom({}, "Xy7-build-id")).toBe("Xy7-build-id");
  });

  it("ничего нет: так и пишем", () => {
    expect(buildVersionFrom({}, null)).toBe(UNKNOWN_VERSION);
    expect(buildVersionFrom({ APP_VERSION: "  " }, "  ")).toBe(UNKNOWN_VERSION);
  });
});
