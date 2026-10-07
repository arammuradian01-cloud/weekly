// Приём из Notion (этап 23, модуль М7): текст разбора встречи вставляют в окно, ресурс показывает кандидатов в задачи
// и решения, администратор подтверждает каждого. Распознавание речи бывает неточным, поэтому ничего не создаётся само.
// Чистые правила разбора текста: их проверяют модульные тесты.

export type NotionCandidate = {
  /** Порядковый ключ в тексте: по нему экран хранит выбор */
  key: string;
  kind: "task" | "decision";
  text: string;
  /** Имя или фамилия после «@» или в начале строки перед двоеточием: кому поручено */
  who?: string;
  /** Срок словами, если нашёлся: «до пятницы», «к 15.10» */
  due?: string;
};

// Границы слов \b в JS только для латиницы, поэтому кириллические слова ищем с явными пробелами и знаками
const DECISION_WORDS = /^(решили|решение|решено|договорились|принято|утвердили)(?=[:\s,.]|$)[:\s,.]*/i;
const TASK_WORDS = /^(задача|поручение|сделать|нужно|надо|todo|to-do|действие|action)(?=[:\s,.]|$)[:\s,.]*/i;
const BULLET = /^\s*(?:[-*•◦▪]|\d+[.)]|\[[ x]\]|☐|☑)\s*/;
const DUE = /(?:^|\s)((?:до|к)\s+(?:(?:\d{1,2}[./]\d{1,2}(?:[./]\d{2,4})?)|понедельника|вторника|среды|четверга|пятницы|субботы|воскресенья|конца недели|конца месяца|след(?:ующей)?\.?\s+недели))/i;

/** Строки текста Notion в кандидаты. Пустые строки и заголовки пропускаются, вложенность не важна */
export function parseNotion(text: string): NotionCandidate[] {
  const out: NotionCandidate[] = [];
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  lines.forEach((raw, i) => {
    let line = raw.replace(BULLET, "").replace(/[—–→⟶⇒]/g, "-").trim();
    if (!line || line.length < 4) return;
    if (/^#+\s/.test(raw) || /^[А-ЯЁA-Z][^.!?]{0,40}:$/.test(line)) return;
    let kind: "task" | "decision" = "task";
    if (DECISION_WORDS.test(line)) {
      kind = "decision";
      line = line.replace(DECISION_WORDS, "").trim();
    } else if (TASK_WORDS.test(line)) {
      line = line.replace(TASK_WORDS, "").trim();
    } else if (/(?:^|\s)(решил|договорил|утвердил|принят)/i.test(line) && !/(?:^|\s)(нужно|надо|сделать|подготовить|прислать|проверить)(?=\s|$)/i.test(line)) {
      kind = "decision";
    }
    let who: string | undefined;
    const at = /@([А-ЯЁA-Z][а-яёa-z]+(?:\s[А-ЯЁA-Z][а-яёa-z]+)?)/.exec(line);
    if (at) {
      who = at[1];
      line = line.replace(at[0], "").replace(/\s{2,}/g, " ").trim();
    } else {
      const lead = /^([А-ЯЁ][а-яё]+(?:\s[А-ЯЁ]\.?)?)\s*[:\-]\s+(.+)$/.exec(line);
      if (lead) {
        who = lead[1];
        line = lead[2]!.trim();
      }
    }
    const due = DUE.exec(line)?.[1];
    if (!line) return;
    out.push({ key: `n${i}`, kind, text: line.replace(/^[,.;:\s]+|[\s,;]+$/g, "").slice(0, 300), ...(who ? { who } : {}), ...(due ? { due } : {}) });
  });
  return out;
}
