// Подбор цели к задаче по тексту (этап 55). Решение Арама 21.10: если по сути задачи понятно, к какой цели она
// относится, цель подтягивается сама, а человек может её поменять или найти другую поиском.
//
// Без внешних сервисов и языковых моделей: слова задачи сравниваются со словами целей. Слова приводятся к основе
// (отрезается частое окончание), а основы совпадают, если одна продолжает другую: «тарифу» и «тарифная»,
// «партнёров» и «партнёрский». Служебные и слишком общие для задач продуктовой команды страхования слова не
// считаются («запуск», «рост», «клиент», «страховой»). Редкие слова весят больше частых.
//
// Цель подставляется сама осторожно: неверная цель тихо портит прогресс целей, а пустое поле человек заполнит сам.
// Нужно не меньше двух совпавших слов, сходство от 0,35 и заметный отрыв от следующей цели. Номер цели в тексте
// («РТ-1», «по D1») подбирает её сразу; чисто цифровой номер («10», «1.2») только с пометкой: «№10», «#10»,
// «цель 10», иначе он совпадает с процентами и датами. Цели с одним совпадением показываются первыми в списке
// с пометкой «по тексту», но в поле не подставляются.

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[‐-―−]/g, "-");

/** Окончания, от длинных к коротким: «калькуляторов» и «калькулятор» дают одну основу */
const ENDINGS = [
  "иями", "ениями", "ениях", "ением", "ений", "ение", "ения", "иях", "ией", "ями", "ами", "ого", "его", "ому", "ему", "ыми", "ими",
  "ах", "ях", "ов", "ев", "ей", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ую", "юю", "ам", "ям", "ом", "ем", "им", "ым",
  "ых", "их", "ия", "ие", "ию", "ии", "а", "я", "о", "е", "ы", "и", "у", "ю", "ь", "й",
];

/** Основа слова: строчные, ё как е, без частого окончания (остаток не короче трёх букв), не длиннее десяти букв */
export function stem(word: string): string {
  let w = norm(word);
  if (/^[a-z0-9]+$/.test(w)) return w.slice(0, 10);
  for (const end of ENDINGS) {
    if (w.length - end.length >= 3 && w.endsWith(end)) {
      w = w.slice(0, -end.length);
      break;
    }
  }
  return w.slice(0, 10);
}

/** Слова, по которым цели не различить: служебные, глаголы постановки и общие для страхового бизнеса */
const STOP_WORDS = [
  "и", "в", "во", "не", "на", "с", "со", "по", "к", "ко", "о", "об", "обо", "от", "для", "до", "из", "за", "у", "а", "но", "или", "что", "как",
  "это", "этот", "эта", "эти", "то", "же", "бы", "ли", "при", "без", "над", "под", "про", "через", "все", "весь", "вся", "его", "ее", "их",
  "мы", "вы", "он", "она", "они", "я", "так", "чтобы", "также", "еще", "уже", "быть", "был", "будет", "есть", "нет", "да", "после", "ниже", "выше",
  "сделать", "сделан", "сделано", "задача", "цель", "новый", "новая", "новое", "новые", "новых", "наш", "наша", "наши", "свой",
  "два", "двух", "три", "трех", "тремя", "один", "одна", "первый", "второй",
  "запуск", "запустить", "запущен", "запущена", "рост", "клиент", "клиенты", "компания", "компании", "отчет", "встреча", "работа",
  "проект", "план", "процесс", "обсудить", "подготовить", "провести", "обновить", "согласовать", "выкатить", "найти", "сделать",
  "страховой", "страховая", "страховые", "страхование", "страховыми", "страховых", "страховщик",
  "квартал", "месяц", "год", "неделя", "млн", "тыс", "руб",
  "the", "a", "an", "of", "to", "in", "for", "and", "or", "on", "with",
];
const STOP = new Set(STOP_WORDS.map(stem));

/** Слова текста для сравнения: без служебных, приведённые к основе, без повторов */
export function tokens(text: string): string[] {
  const words = norm(text).split(/[^a-zа-я0-9]+/i).filter(Boolean);
  return [...new Set(words.filter((w) => w.length >= 2 && !/^\d+$/.test(w)).map(stem).filter((s) => !STOP.has(s)))];
}

/** Основы совпадают: одинаковые или одна продолжает другую, если короткая не меньше четырёх знаков */
export function sameStem(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 4 && long.startsWith(short);
}

const codeNorm = (s: string) => norm(s).replace(/\s+/g, "").replace(/-/g, "");

/**
 * Номер цели в тексте задачи: «РТ-1», «рт 1», «РТ1», «по D1». Чисто цифровой номер («10», «1.2») только с пометкой
 * «№», «#» или словом «цель» перед ним. Короче двух знаков номер не ищем: совпадёт случайно
 */
export function mentionsCode(text: string, code: string | null | undefined): boolean {
  if (!code) return false;
  const want = codeNorm(code);
  if (want.length < 2) return false;
  const numeric = /^[0-9.]+$/.test(want);
  const words = norm(text)
    .split(/[^a-zа-я0-9.#№-]+/i)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (numeric) {
      if (/^[#№]/.test(w) && codeNorm(w.slice(1)) === want) return true;
      if ((w === "#" || w === "№" || /^цел/.test(w)) && words[i + 1] && codeNorm(words[i + 1]!) === want) return true;
      continue;
    }
    if (codeNorm(w.replace(/^[#№]/, "")) === want) return true;
    // «рт 1»: буквы номера отдельным словом и цифра следом. Предлог из одной буквы («в 1 квартале») не склеиваем
    const next = words[i + 1];
    if (next && /^[a-zа-я]{2,}$/.test(w) && /^[0-9]/.test(next) && codeNorm(`${w}${next}`) === want) return true;
  }
  return false;
}

export type GoalDoc = { id: string; title: string; code?: string | null; metric?: string | null; description?: string | null };
/** score: сходство от 0 до 1; matches: сколько слов задачи совпало со словами цели; code: номер цели в тексте */
export type GoalScore = { id: string; score: number; matches: number; code: boolean };

/**
 * Насколько текст задачи подходит каждой цели, от 0 до 1. Косинус между словами задачи и цели с весом редкости
 * слова среди этих целей; считаются только слова задачи, которые встречаются в целях. Название цели весит
 * полностью, метрика и описание наполовину
 */
export function rankGoals(text: string, goals: GoalDoc[]): GoalScore[] {
  if (!goals.length) return [];
  const task = tokens(text);
  const docs = goals.map((g) => {
    const weights = new Map<string, number>();
    for (const t of tokens(g.title)) weights.set(t, 1);
    for (const t of tokens(`${g.metric ?? ""} ${g.description ?? ""}`)) if (!weights.has(t)) weights.set(t, 0.5);
    return { g, weights };
  });
  const n = goals.length;
  // В скольких целях есть слово (с совпадением основ): чем реже, тем весомее
  const dfCache = new Map<string, number>();
  const df = (t: string) => {
    let v = dfCache.get(t);
    if (v === undefined) {
      v = docs.filter((d) => [...d.weights.keys()].some((g) => sameStem(t, g))).length;
      dfCache.set(t, v);
    }
    return v;
  };
  const idf = (t: string) => Math.log(1 + n / Math.max(df(t), 0.5));
  // Слова задачи, которых нет ни в одной цели, не штрафуют: в задаче всегда много своих слов
  const known = task.filter((t) => df(t) > 0);
  const taskNorm = Math.sqrt(known.reduce((s, t) => s + idf(t) ** 2, 0));
  return docs
    .map(({ g, weights }) => {
      if (mentionsCode(text, g.code)) return { id: g.id, score: 1, matches: 0, code: true };
      if (!taskNorm) return { id: g.id, score: 0, matches: 0, code: false };
      let dot = 0;
      let matches = 0;
      for (const t of known) {
        let best = 0;
        for (const [gt, w] of weights) if (sameStem(t, gt)) best = Math.max(best, idf(gt) * w);
        if (best) {
          dot += idf(t) * best;
          matches += 1;
        }
      }
      let docNorm = 0;
      for (const [gt, w] of weights) docNorm += (idf(gt) * w) ** 2;
      const score = docNorm ? Math.min(1, dot / (taskNorm * Math.sqrt(docNorm))) : 0;
      return { id: g.id, score: Math.round(score * 1000) / 1000, matches, code: false };
    })
    .sort((a, b) => b.score - a.score);
}

/** Порог «по тексту»: цель показывается первой в списке с пометкой, но сама не подставляется */
export const SUGGEST_MIN = 0.2;
/** Порог автоподстановки: вместе с двумя совпавшими словами и отрывом от следующей цели */
export const AUTO_MIN = 0.35;

/** Цель, которую можно подставить самой. Иначе null: при равенстве или слабом сходстве человек выберет сам */
export function bestGoal(ranked: GoalScore[]): string | null {
  const [first, second] = ranked;
  if (!first) return null;
  if (first.code) return second?.code ? null : first.id;
  if (first.score < AUTO_MIN || first.matches < 2) return null;
  if (second && second.score >= first.score * 0.8) return null;
  return first.id;
}
