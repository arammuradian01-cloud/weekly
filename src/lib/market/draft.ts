// Несохранённые правки в настройке рынка (этап 72). Решение Арама 23.10: он добавил шесть человек и не сохранил,
// потому что кнопка «Сохранить» одна и внизу под длинным списком команд. Теперь под каждым списком строка
// «Не сохранено: ...» со своей кнопкой, а уход со страницы с несохранёнными правками браузер переспрашивает.
// Здесь только расчёты и тексты без браузера и базы: их проверяют модульные тесты

import { plural } from "@/domain/dates";

export type ListDiff = { add: number; remove: number };

/** Сколько добавлено и убрано в черновике против сохранённого списка. Порядок не важен */
export function listDiff(draft: string[], saved: string[]): ListDiff {
  const was = new Set(saved);
  const now = new Set(draft);
  return { add: [...now].filter((x) => !was.has(x)).length, remove: [...was].filter((x) => !now.has(x)).length };
}

export const isDirty = (d: ListDiff) => d.add > 0 || d.remove > 0;

/** «Не сохранено: добавить 6, убрать 1»; нулевую часть не пишем */
export function unsavedText(d: ListDiff): string {
  const parts = [d.add ? `добавить ${d.add}` : "", d.remove ? `убрать ${d.remove}` : ""].filter(Boolean);
  return `Не сохранено: ${parts.join(", ")}`;
}

const people = (n: number) => `${plural(n, "видит", "видят", "видят")} ${n} ${plural(n, "человек", "человека", "человек")}`;

/**
 * Счётчик под заголовком раздела: сколько видят раздел при личном входе без режима управления (владельцы и люди из
 * списка). Плюс администраторы в режиме управления, и, пока общий логин включён, все, кто входит по нему
 */
export function marketCountText(count: number, owners: number, teamLogin: boolean): string {
  return `Сейчас раздел ${people(count)}, из них владельцев ${owners}, плюс администраторы в режиме управления${teamLogin ? " и все, кто входит по общему логину" : ""}.`;
}

/** Уведомление после сохранения списка людей */
export function marketSavedText(count: number): string {
  return `Доступ к рынку сохранён: раздел ${people(count)}`;
}

export const LEAVE_TEXT = "Доступ к рынку не сохранён. Уйти со страницы без сохранения?";

/**
 * Уводит ли щелчок по ссылке с этой страницы внутри приложения: тот же сайт, другой путь или параметры. Ссылки на
 * якорь этой же страницы (оглавление настроек) не уводят, чужие сайты переспрашивает сам браузер (beforeunload)
 */
export function leavesPage(href: string, current: string): boolean {
  let to: URL;
  let at: URL;
  try {
    at = new URL(current);
    to = new URL(href, at);
  } catch {
    return false;
  }
  if (to.origin !== at.origin) return false;
  return to.pathname !== at.pathname || to.search !== at.search;
}
