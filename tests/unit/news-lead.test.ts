// Этап 68: главная новость. Официальный источник (регулятор, союзы) узнаётся по слову целиком, а не по части слова
import { describe, expect, it } from "vitest";
import { pickLead } from "@/components/news/news-list";
import type { NewsItemView } from "@/lib/news/service";

const now = new Date("2026-10-22T12:00:00+03:00");

const item = (id: string, source: string, publishedAt = "2026-10-22T09:00:00+03:00"): NewsItemView => ({
  id,
  title: `Новость ${id}`,
  url: `https://example.org/${id}`,
  summary: "",
  publishedAt,
  source,
  directions: [],
  summaryBy: "source",
});

describe("pickLead", () => {
  it("официальный источник за сегодня главнее первой новости", () => {
    expect(pickLead([item("a", "Интерфакс"), item("b", "РСА")], now)?.id).toBe("b");
    expect(pickLead([item("a", "Интерфакс"), item("b", "Банк России")], now)?.id).toBe("b");
    expect(pickLead([item("a", "Интерфакс"), item("b", "Всероссийский союз страховщиков")], now)?.id).toBe("b");
  });

  it("часть слова не делает источник официальным", () => {
    // «РСА» внутри «ПРСА» и «РСАТ», «ЦБ РФ» внутри «ЦБ РФА»: не официальные, главной остаётся первая сегодняшняя
    expect(pickLead([item("a", "Интерфакс"), item("b", "ПРСА Медиа"), item("c", "РСАТ"), item("d", "ЦБ РФА")], now)?.id).toBe("a");
  });

  it("граница слова по знакам, а не только по пробелам", () => {
    expect(pickLead([item("a", "Интерфакс"), item("b", "Пресс-служба РСА")], now)?.id).toBe("b");
    expect(pickLead([item("a", "Интерфакс"), item("b", "Банк России (пресс-релизы)")], now)?.id).toBe("b");
  });

  it("за сегодня новостей нет: главной нет, вчерашняя официальная не главная", () => {
    expect(pickLead([item("a", "РСА", "2026-10-21T09:00:00+03:00")], now)).toBeNull();
    expect(pickLead([], now)).toBeNull();
  });
});
