// Подбор цели к задаче по тексту (этап 55). Решение Арама 21.10: если по сути задачи понятно, к какой цели она
// относится, цель подтягивается сама, а человек может её поменять или найти другую поиском.
//
// Без внешних сервисов и языковых моделей: слова задачи сравниваются со словами целей. Слова приводятся к основе
// (отрезаются частые окончания), служебные слова не считаются, редкие слова весят больше частых: «ОСАГО» в цели
// говорит больше, чем «рост». Номер цели в тексте задачи («РТ-1») подбирает её сразу. Цель предлагается, только
// если она заметно лучше остальных: при равенстве двух целей ничего не подставляем, человек выберет сам.

/** Служебные и слишком общие для задач слова: по ним цели не различить */
const STOP = new Set(
  [
    "и", "в", "во", "не", "на", "с", "со", "по", "к", "ко", "о", "об", "обо", "от", "для", "до", "из", "за", "у", "а", "но", "или", "что", "как",
    "это", "этот", "эта", "эти", "то", "же", "бы", "ли", "при", "без", "над", "под", "про", "через", "все", "всё", "весь", "вся", "его", "её", "их",
    "мы", "вы", "он", "она", "они", "я", "так", "чтобы", "также", "ещё", "уже", "быть", "был", "будет", "есть", "нет", "да", "до", "после",
    "сделать", "сделан", "сделано", "задача", "задачи", "цель", "цели", "новый", "новая", "новое", "новые", "наш", "наша", "наши", "свой",
    "the", "a", "an", "of", "to", "in", "for", "and", "or", "on", "with",
  ].map((w) => w.replace(/ё/g, "е")),
);

/** Окончания, от длинных к коротким: «калькуляторов» и «калькулятор» дают одну основу */
const ENDINGS = [
  "ениями", "ениях", "ением", "ений", "ение", "ения", "иями", "ями", "ами", "ией", "иях", "ого", "его", "ому", "ему", "ыми", "ими",
  "ах", "ях", "ов", "ев", "ей", "ий", "ый", "ой", "ая", "яя", "ое", "ее", "ые", "ие", "ую", "юю", "ам", "ям", "ом", "ем", "им", "ым",
  "а", "я", "о", "е", "ы", "и", "у", "ю", "ь",
];

/** Основа слова: строчные, ё как е, без частого окончания, не короче четырёх букв и не длиннее восьми */
export function stem(word: string): string {
  let w = word.toLowerCase().replace(/ё/g, "е");
  if (/^[a-z0-9]+$/.test(w)) return w.slice(0, 8);
  for (const end of ENDINGS) {
    if (w.length - end.length >= 4 && w.endsWith(end)) {
      w = w.slice(0, -end.length);
      break;
    }
  }
  return w.slice(0, 8);
}

/** Слова текста для сравнения: без служебных, приведённые к основе, без повторов */
export function tokens(text: string): string[] {
  const words = text.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9]+/i).filter(Boolean);
  return [...new Set(words.filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+$/.test(w)).map(stem))];
}

const normCode = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[\s.]+/g, "");

/** Номер цели в тексте задачи: «РТ-1», «рт 1», «РТ1». Номер не короче двух знаков, иначе совпадёт случайно */
export function mentionsCode(text: string, code: string | null | undefined): boolean {
  if (!code || normCode(code).length < 2) return false;
  const want = normCode(code).replace(/-/g, "");
  const words = text.toLowerCase().replace(/ё/g, "е").split(/[^a-zа-я0-9-]+/i).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const one = words[i]!.replace(/-/g, "");
    const two = `${words[i]}${words[i + 1] ?? ""}`.replace(/-/g, "");
    if (one === want || two === want) return true;
  }
  return false;
}

export type GoalDoc = { id: string; title: string; code?: string | null; metric?: string | null; description?: string | null };
export type GoalScore = { id: string; score: number };

/**
 * Насколько текст задачи подходит каждой цели, от 0 до 1. Косинус между словами задачи и цели с весом редкости слова
 * среди этих целей; считаются только слова задачи, которые встречаются в целях. Название цели весит полностью,
 * метрика и описание наполовину
 */
export function rankGoals(text: string, goals: GoalDoc[]): GoalScore[] {
  const task = tokens(text);
  if (!goals.length) return [];
  const docs = goals.map((g) => {
    const weights = new Map<string, number>();
    for (const t of tokens(g.title)) weights.set(t, 1);
    for (const t of tokens(`${g.metric ?? ""} ${g.description ?? ""}`)) if (!weights.has(t)) weights.set(t, 0.5);
    return { g, weights };
  });
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.weights.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const n = goals.length;
  const idf = (t: string) => Math.log(1 + n / (df.get(t) ?? 0.5));
  // Слова задачи, которых нет ни в одной цели, не штрафуют: в задаче всегда много своих слов
  const known = task.filter((t) => df.has(t));
  const taskNorm = Math.sqrt(known.reduce((s, t) => s + idf(t) ** 2, 0));
  return docs
    .map(({ g, weights }) => {
      if (mentionsCode(text, g.code)) return { id: g.id, score: 1 };
      if (!taskNorm) return { id: g.id, score: 0 };
      let dot = 0;
      let docNorm = 0;
      for (const [t, w] of weights) {
        docNorm += (idf(t) * w) ** 2;
        if (task.includes(t)) dot += idf(t) * idf(t) * w;
      }
      return { id: g.id, score: docNorm ? Math.round((dot / (taskNorm * Math.sqrt(docNorm))) * 1000) / 1000 : 0 };
    })
    .sort((a, b) => b.score - a.score);
}

/** Порог уверенности: ниже цель не подставляется сама, только показывается в начале списка */
export const SUGGEST_MIN = 0.2;

/** Цель, которую можно подставить самой: достаточно похожа и заметно лучше следующей. Иначе null */
export function bestGoal(ranked: GoalScore[]): string | null {
  const [first, second] = ranked;
  if (!first || first.score < SUGGEST_MIN) return null;
  if (first.score >= 1) return first.id;
  if (second && second.score >= first.score * 0.8) return null;
  return first.id;
}
