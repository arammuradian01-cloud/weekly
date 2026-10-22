// Запасной разбор встречи правилами (этап 61): без ключа Claude или когда Claude не ответил. Читает текст страницы Notion
// с заголовками и списками: разделы «Итоги», «Решения», «Задачи», «Риски», «Дальше», строки списков в них. В строке задачи
// ищет ответственного («Ответственный: Фамилия», «@Имя», «Фамилия: что сделать», «(Фамилия)») и срок («до 25.10»,
// «до пятницы»). Экран честно пишет, что разобрано правилами: разбор правилами грубее, всё стоит проверить.

import { DUE_PATTERN, PARSE_LIMITS, buildDraft, cleanText, dueFromText, taskTitle, type RawMeeting, type RawTask, type TaggedLine } from "./parse-types";
import type { IsoDate } from "@/domain/dates";
import { DEFAULT_PRODUCTS, productNamed, type ProductRef } from "@/lib/weekly-blocks/types";

export type RulesOptions = {
  /** Дата встречи: от неё считаются сроки «до пятницы» и год у «до 25.10» */
  base: IsoDate;
  /** Есть ли такой человек в компании: имя в скобках или после дефиса в конце строки берётся, только если он есть */
  knows?: (name: string) => boolean;
  /** Продукты справочника (этап 66): разделы «ОСАГО», «КАСКО» в заметке раскладываются в блок «Продукты» */
  products?: readonly ProductRef[];
};

/**
 * Разделы заметки. С этапа 66 и смысловые блоки weekly для CEO: «Новости», «Конкуренты», «Партнёры», «Продукты» и
 * разделы с названием продукта («ОСАГО», «Депозиты и инвестиции»). Их строки идут в итоги и в свои блоки черновика
 */
type Section = "summary" | "decisions" | "tasks" | "risks" | "next" | "news" | "competitors" | "partners" | "products" | `product:${string}`;

const SECTIONS: [Section, RegExp][] = [
  ["decisions", /^(решени|решили|договор[её]нн|договорились|принят)/],
  ["tasks", /^(задач|поручени|action|экшн|todo|to-do|что сделать|кто что делает|ответственн)/],
  ["risks", /^(риск|проблем|блокер|открытые вопросы)/],
  ["next", /^(что дальше|дальше|следующ|планы|план на|next)/],
  ["competitors", /^(конкурент)/],
  ["news", /^(новост|рынок|по рынку|команда|по команде)/],
  ["partners", /^(партн[её]р)/],
  ["products", /^(продукты|по продуктам)/],
  ["summary", /^(итог|главное|резюме|кратко|summary|ключев|основное|о ч[её]м говорили)/],
];

const BULLET = /^\s*(?:[-*•◦▪]|\d+[.)])\s+/;
const CHECKBOX = /^\s*(?:[-*]\s*)?\[( |x|X)\]\s*/;
const DECISION_LEAD = /^(решили|решение|решено|договорились|договорённость|договоренность|принято|утвердили)(?=[:\s,.]|$)[:\s,.-]*/i;
const TASK_LEAD = /^(задача|поручение|сделать|todo|to-do|action)(?=[:\s,.]|$)[:\s,.-]*/i;
const OWNER_MARK = /(?:^|[\s,;(])(?:ответственн(?:ый|ая|ые)|отв\.|исполнител(?:ь|и)|кто)\s*[:-]\s*/i;
const CO_MARK = /(?:^|[\s,;(])(?:соисполнител(?:ь|и)|вместе с)\s*[:-]?\s*/i;
const RESULT_MARK = /(?:^|[\s;(])(?:результат|что на выходе)\s*[:-]\s*/i;
/** Слова перед двоеточием, которые не имя человека */
const LABELS = new Set(["итог", "итоги", "важно", "решение", "решили", "задача", "вопрос", "риск", "срок", "цель", "результат", "комментарий", "примечание", "статус", "идея", "план", "дальше", "next", "action", "todo", "главное", "договорились", "ответственный", "контекст", "проблема", "кратко", "суть", "пример", "почему", "зачем", "что"]);
const NAME = /^[А-ЯЁA-Z][а-яёa-z]+(?:\s+[А-ЯЁA-Z][а-яёa-z]*\.?){0,2}$/;

function sectionOf(heading: string, products: readonly ProductRef[] = DEFAULT_PRODUCTS): Section | null {
  const named = productNamed(heading.replace(/^[^\p{L}\p{N}]+/u, ""), products);
  if (named) return named === "partners" ? "partners" : `product:${named}`;
  const h = heading
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/^[^a-zа-я]+/i, "")
    .trim();
  for (const [s, re] of SECTIONS) if (re.test(h)) return s;
  return null;
}

/** Похоже на имя человека: одно-три слова с заглавной, не служебная подпись. Если ресурс знает людей, спрашиваем его */
function looksLikeName(value: string, knows?: (name: string) => boolean): boolean {
  const v = value.trim().replace(/\.$/, "");
  if (!v || v.length > 40 || !NAME.test(v)) return false;
  if (LABELS.has(v.toLowerCase())) return false;
  return knows ? knows(v) : true;
}

const splitNames = (value: string) =>
  value
    .split(/\s*(?:,|;|\/|\sи\s)\s*/)
    .map((s) => s.replace(/^@/, "").replace(/[.)\s]+$/, "").trim())
    .filter((s) => s && s.length <= PARSE_LIMITS.name);

/** Кусок после метки до конца фразы: до точки с запятой, скобки, точки в конце или слова о сроке */
function takeAfter(text: string, mark: RegExp): { value: string; rest: string } | null {
  const m = mark.exec(text);
  if (!m) return null;
  const start = m.index + m[0].length;
  const tail = text.slice(start);
  const end = tail.search(/[;()]|\.\s|\.$|,?\s(?:срок|дедлайн)(?=[\s:.,-]|$)|\s(?:до|к)\s+\d|\s(?:до|к)\s+(?:понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|конц[ау])/i);
  const value = (end === -1 ? tail : tail.slice(0, end)).trim();
  const rest = `${text.slice(0, m.index)} ${end === -1 ? "" : tail.slice(end)}`.replace(/\s{2,}/g, " ").trim();
  return { value, rest };
}

/** Строка задачи: ответственный, соисполнители, срок, результат и сама задача */
export function taskFromLine(line: string, opts: RulesOptions): RawTask {
  let text = cleanText(line, 2000).replace(TASK_LEAD, "");
  let owner: string | null = null;
  let co: string[] = [];
  let outcome: string | null = null;

  const result = takeAfter(text, RESULT_MARK);
  if (result) {
    outcome = result.value;
    text = result.rest;
  }
  const ownerPart = takeAfter(text, OWNER_MARK);
  if (ownerPart) {
    const names = splitNames(ownerPart.value);
    owner = names[0] ?? null;
    co = names.slice(1);
    text = ownerPart.rest;
  }
  const coPart = takeAfter(text, CO_MARK);
  if (coPart) {
    co = [...co, ...splitNames(coPart.value)];
    text = coPart.rest;
  }
  // @Имя Фамилия: первое упоминание ответственный, остальные соисполнители
  const mentions = [...text.matchAll(/@([А-ЯЁA-Z][а-яёa-z]+(?:\s[А-ЯЁA-Z][а-яёa-z]+)?)/g)];
  if (mentions.length) {
    const names = mentions.map((m) => m[1]!);
    if (!owner) owner = names.shift() ?? null;
    co = [...co, ...names];
    text = text.replace(/@([А-ЯЁA-Z][а-яёa-z]+(?:\s[А-ЯЁA-Z][а-яёa-z]+)?)/g, "$1").trim();
    // Упомянутый в начале строки не часть задачи: «@Логинова прислать выгрузку»
    if (owner && text.startsWith(owner)) text = text.slice(owner.length).replace(/^[\s,:-]+/, "");
  }
  if (!owner) {
    // «Рева: прислать выгрузку», «Рева Тарас - прислать выгрузку». Незнакомое имя тоже берём: строка потребует выбора
    // ответственного и покажет, кто был назван на встрече
    const lead = /^([^:\-]{2,40}?)\s*(?::|\s-\s)\s*(.+)$/.exec(text);
    if (lead && looksLikeName(lead[1]!)) {
      owner = lead[1]!.trim();
      text = lead[2]!.trim();
    }
  }
  if (!owner) {
    // «прислать выгрузку (Рева)», «прислать выгрузку - Рева»
    const tail = /\s*(?:\(([^)]{2,40})\)|\s-\s([^-]{2,40}))\s*\.?$/.exec(text);
    const name = tail ? (tail[1] ?? tail[2])!.split(",")[0]!.trim() : null;
    if (tail && name && looksLikeName(name, opts.knows)) {
      owner = name;
      text = text.slice(0, tail.index).trim();
    }
  }
  const { due, dueText } = dueFromText(text, opts.base);
  if (dueText) text = text.replace(DUE_PATTERN, (m) => (m.startsWith(" ") || m.startsWith(",") || m.startsWith("(") ? " " : "")).replace(/\(\s*\)/g, "");
  text = text.replace(/([.,;])\s*[,;]+/g, "$1").replace(/\s{2,}/g, " ").replace(/^[\s,;:.-]+|[\s,;:-]+$/g, "");
  const title = taskTitle(text || line);
  return {
    title,
    outcome: cleanText(outcome || text || title, PARSE_LIMITS.outcome),
    owner: owner ? cleanText(owner, PARSE_LIMITS.name) : null,
    coExecutors: [...new Set(co.map((c) => cleanText(c, PARSE_LIMITS.name)).filter((c) => c && c !== owner))].slice(0, PARSE_LIMITS.coExecutors),
    due,
    dueText,
    direction: null,
  };
}

/** Похоже ли на задачу строка вне разделов: чек-бокс, ответственный, упоминание или срок */
function taskLike(raw: string, line: string): boolean {
  return CHECKBOX.test(raw) || TASK_LEAD.test(line) || OWNER_MARK.test(line) || /@[А-ЯЁA-Z]/.test(line) || DUE_PATTERN.test(line);
}

/** Текст встречи в сырой разбор: итоги, решения, риски, что дальше, задачи */
export function parseByRules(text: string, opts: RulesOptions): RawMeeting {
  const out: RawMeeting = { summary: [], decisions: [], risks: [], next: [], ceo: null, tasks: [] };
  const products = opts.products ?? DEFAULT_PRODUCTS;
  const loose: string[] = [];
  const tagged: TaggedLine[] = [];
  let section: Section | null = null;
  for (const raw of String(text ?? "").replace(/\r/g, "").split("\n")) {
    if (!raw.trim()) continue;
    const heading = /^\s*#{1,6}\s+(.+)$/.exec(raw);
    const isBullet = BULLET.test(raw) || CHECKBOX.test(raw);
    const plain = cleanText(raw.replace(CHECKBOX, "").replace(BULLET, "").replace(/^>\s*/, ""), 2000);
    if (heading) {
      section = sectionOf(heading[1]!, products);
      continue;
    }
    // «Решения:» или «Итоги встречи» отдельной строкой без точки: подпись раздела
    if (!isBullet && plain.length <= 60 && (/:$/.test(plain) || (sectionOf(plain, products) && !/[.!?\d]/.test(plain) && plain.split(/\s+/).length <= 3))) {
      const s = sectionOf(plain.replace(/:$/, ""), products);
      if (s || /:$/.test(plain)) {
        section = s;
        continue;
      }
    }
    if (!plain || plain === "---" || plain.length < 3) continue;
    const kind: Section | "loose" =
      section === "tasks"
        ? "tasks"
        : section === "decisions"
          ? "decisions"
          : DECISION_LEAD.test(plain)
            ? "decisions"
            : section === "next" && taskLike(raw, plain) && (OWNER_MARK.test(plain) || /@[А-ЯЁA-Z]/.test(plain) || DUE_PATTERN.test(plain))
              ? "tasks"
              : section
                ? section
                : taskLike(raw, plain)
                  ? "tasks"
                  : "loose";
    if (kind === "tasks") {
      if (out.tasks.length < PARSE_LIMITS.tasks) out.tasks.push(taskFromLine(plain, opts));
      if (section === "next") out.next.push(cleanText(plain));
    } else if (kind === "decisions") {
      const t = taskFromLine(plain.replace(DECISION_LEAD, ""), opts);
      const body = cleanText(plain.replace(DECISION_LEAD, ""));
      if (body && out.decisions.length < PARSE_LIMITS.decisions) out.decisions.push({ text: body, owner: OWNER_MARK.test(body) || /@/.test(body) ? t.owner : null });
    } else if (kind === "loose") {
      loose.push(plain);
    } else if (kind === "news" || kind === "competitors" || kind === "partners" || kind === "products" || kind.startsWith("product:")) {
      // Смысловой блок weekly для CEO: строка и в итогах встречи, и в своём блоке черновика
      const text = cleanText(plain);
      out.summary.push(text);
      tagged.push(kind.startsWith("product:") ? { key: "products", product: kind.slice(8), text } : { key: kind as TaggedLine["key"], product: kind === "partners" ? "partners" : null, text });
    } else {
      out[kind as "summary" | "risks" | "next"].push(cleanText(plain));
    }
  }
  // Итогов разделом нет: главное из строк вне разделов, первые несколько
  if (!out.summary.length) out.summary = loose.slice(0, 7).map((l) => cleanText(l));
  out.summary = out.summary.slice(0, PARSE_LIMITS.listItems);
  out.risks = out.risks.slice(0, PARSE_LIMITS.listItems);
  out.next = out.next.slice(0, PARSE_LIMITS.listItems);
  // Разделы смысловых блоков нашлись: черновик weekly для CEO сразу по ним, остальное из итогов, решений и рисков
  if (tagged.length) out.ceo = buildDraft(out, products, tagged);
  return out;
}
