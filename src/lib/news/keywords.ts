// Ключевые слова по продуктам (этап 60) без базы: их читают и экран настроек в браузере, и привязка на сервере.
//
// Ключевое слово сравнивается с началом слова в тексте без учёта регистра и буквы ё: «страхов» ловит «страхование»,
// «страховщик» и «страховой», «ОСАГО» ловит «е-ОСАГО». Фраза из нескольких слов ищется целиком.
// Стартовый список ниже: предложение, его подтверждает Арам, а правит владелец в «Настройках».

export const KEYWORDS_KEY = "news.keywords";

/** Коды направлений из справочника, у которых есть стартовые слова. Остальные направления получают пустой список */
export const DEFAULT_KEYWORDS: Record<string, string[]> = {
  osago: ["ОСАГО", "автогражданк", "РСА", "союз автостраховщиков", "европротокол", "КБМ", "бонус-малус", "тарифный коридор", "автоюрист", "АИС страхован", "страховая история"],
  kasko: ["КАСКО", "автострахован", "страхование автомобил", "угон", "каршеринг", "мини-каско"],
  red: ["ипотечн страхован", "страхование ипотек", "ипотек", "застройщик", "страхование недвижимост", "титульн", "страхование жизни заемщик", "страхование квартир"],
  deposits: ["вклад", "депозит", "ключевая ставка", "ключевой ставк", "ставки по вкладам", "инвестиц", "брокер", "ИИС", "ПИФ", "облигац", "накопительн", "доходност", "биржа", "Мосбирж"],
  partners: ["партнёрск", "агрегатор", "финансовый маркетплейс", "страховой маркетплейс", "банкострахован", "агентск", "комиссионн", "лидогенерац", "Сравни", "Банки.ру", "Финуслуги"],
  product: ["онлайн-страхован", "онлайн-оформлен", "электронный полис", "страховой маркетплейс", "цифровой полис", "дистанционное урегулирован", "приложение страхов", "Госуслуг"],
  insurance: ["страхов", "ВСС", "союз страховщиков", "ДМС", "НСЖ", "ИСЖ", "ДСЖ", "перестрахован"],
  department: [],
};

/** Пределы: длина списка одного продукта и длина одного слова */
export const KEYWORD_LIMITS = { perDirection: 60, length: 60 };

/** Настройка из базы в чистый список: только строки, без пустых и повторов, в пределах лимитов */
export function keywordsOf(value: unknown, directions: string[]): Record<string, string[]> {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const out: Record<string, string[]> = {};
  for (const code of directions) {
    const list = raw ? raw[code] : undefined;
    out[code] = raw && code in raw ? normalizeKeywords(Array.isArray(list) ? list : []) : [...(DEFAULT_KEYWORDS[code] ?? [])];
  }
  return out;
}

/** Строка из поля настроек («ОСАГО, РСА, европротокол») в список слов */
export function parseKeywordLine(text: string): string[] {
  return normalizeKeywords(text.split(/[,;\n]/));
}

export function normalizeKeywords(list: unknown[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    if (typeof v !== "string") continue;
    const word = v.replace(/\s+/g, " ").trim().slice(0, KEYWORD_LIMITS.length);
    const key = foldText(word);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(word);
    if (out.length >= KEYWORD_LIMITS.perDirection) break;
  }
  return out;
}

/** Текст для сравнения: без регистра, ё как е, дефисы и лишние пробелы схлопнуты */
export function foldText(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е").replace(/[ \s]+/g, " ").trim();
}
