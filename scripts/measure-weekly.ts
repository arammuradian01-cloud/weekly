// Замер живых данных перед пересборкой экрана «Сдать weekly» (этап 87): пять ответов из раздела «Что проверить на
// живых данных до начала пересборки» документа docs/resheniya-peresborka-sdachi-weekly.md.
// npm run measure:weekly -- [--weeks 12] [--out zamer.txt]
// --weeks: сколько последних недель смотреть на привычку (по умолчанию 12; выборка миграции всегда за 4 недели).
// --out: сложить тот же текст в файл рядом с командой. Файл с живыми текстами и именами в репозиторий не коммитить.
// Только чтение: команда ничего не записывает в базу. Адрес базы берётся из переменной окружения, как у остальных команд.
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db";
import { PERIOD_WEEKS, measure } from "../src/lib/weekly-measure/collect";
import { surveyText } from "../src/lib/weekly-measure/text";

function weeksArg(args: string[]): number {
  const at = args.indexOf("--weeks");
  const value = at >= 0 ? Number(args[at + 1]) : NaN;
  return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), 52) : PERIOD_WEEKS;
}

try {
  const args = process.argv.slice(2);
  const outAt = args.indexOf("--out");
  const text = surveyText(await measure({ weeks: weeksArg(args) }));
  console.log(text);
  if (outAt >= 0) {
    const file = args[outAt + 1];
    if (!file) throw new Error("После --out нужен путь к файлу");
    writeFileSync(file, `${text}\n`, "utf8");
    console.log(`\nТот же текст сложен в ${file}. В репозиторий этот файл не коммитить: в нём живые тексты и имена.`);
  }
} catch (error) {
  console.error("Замер не сделан:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
