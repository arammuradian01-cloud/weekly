// Цифры недели без базы (этап 24): типы блока и текст для отчёта CEO. Нужны и серверу, и экранам

import type { IsoDate } from "@/domain/dates";
import type { WeekKey } from "@/domain/types";
import type { Unit } from "./parse";

export type WeekFigure = {
  key: string;
  label: string;
  unit: Unit;
  value: number | null;
  prev: number | null;
  text: string;
  delta: string | null;
  /** Последние недели для искры: от старых к новым */
  history: { week: IsoDate; value: number | null }[];
};

export type WeekNumbers = {
  /** Понедельник недели, за которую цифры */
  week: WeekKey;
  /** Цифры за эту неделю уже есть в отчёте */
  ready: boolean;
  figures: WeekFigure[];
  /** Источник задан */
  connected: boolean;
  latestWeek: IsoDate | null;
};

/** Текст блока для копирования в отчёт CEO */
export function numbersText(n: WeekNumbers): string[] {
  if (!n.connected) return ["Недельный отчёт не подключён: цифры появятся, когда владелец укажет ссылку на странице «Синхронизация»."];
  if (!n.figures.length) return ["Цифры не выбраны: владелец отмечает строки отчёта на странице «Синхронизация»."];
  if (!n.ready) return [`За неделю с ${n.week} цифр в отчёте ещё нет${n.latestWeek ? `, последняя заполненная неделя с ${n.latestWeek}` : ""}.`];
  return n.figures.map((f) => `- ${f.label}: ${f.text}${f.delta ? ` (${f.delta} к прошлой неделе)` : ""}`);
}
