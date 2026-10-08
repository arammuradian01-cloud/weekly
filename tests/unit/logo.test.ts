import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Логотип Сравни: в SVG брендбука знак (две половинки круга) хранится растром, и в исходных файлах эти картинки
// пустые. На стенде 08.10 из-за этого было видно только слово «сравни». Знак встроен в файл из официального PNG:
// проверяем, что он на месте, а пустых узоров и картинок без данных не осталось

const files = ["sravni_logo_rus.svg", "sravni_logo_rus_w.svg"];

describe("логотип в public/logo", () => {
  for (const name of files) {
    it(`${name}: знак встроен, пустых картинок нет, без полей`, () => {
      const svg = readFileSync(join(process.cwd(), "public", "logo", name), "utf8");
      const images = [...svg.matchAll(/<image\b[^>]*>/g)].map((m) => m[0]);
      expect(images).toHaveLength(1);
      expect(images[0]).toMatch(/href="data:image\/png;base64,[A-Za-z0-9+/=]{2000,}"/);
      expect(svg).not.toMatch(/url\(#pattern/);
      expect(svg).not.toMatch(/c2pa/);
      // Слово «сравни» векторное: путь в цвете бренда (тёмно-синий или белый)
      expect(svg).toMatch(/fill="(#002A3A|white)"/);
      const [, , , w, h] = svg.match(/viewBox="([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)"/)!.map(Number);
      expect(w / h).toBeGreaterThan(5);
      expect(w / h).toBeLessThan(6);
    });
  }
});
