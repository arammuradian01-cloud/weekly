// Стартовый состав и справочники из разделов 2-4 ТЗ.
// Сид только добавляет недостающее и никогда не перезаписывает то, что потом поменяли в ресурсе.

import type { DictKind, Role } from "../src/generated/prisma/client";

type DictSeed = { code: string; label: string; color?: string; active?: boolean; isDefault?: boolean };

export const dictionaries: Record<DictKind, DictSeed[]> = {
  DIRECTION: [
    { code: "osago", label: "ОСАГО" },
    { code: "kasko", label: "КАСКО" },
    { code: "red", label: "RED" },
    { code: "deposits", label: "Депозиты и инвестиции" },
    { code: "partners", label: "Партнёрка" },
    { code: "product", label: "Продукт и CJM" },
    // Есть в Insurance&Invest Bord (вкладка Weekly CEO), добавлено 05.10.2026
    { code: "insurance", label: "Страхование в целом" },
    { code: "department", label: "Департамент" },
  ],
  WEEKLY_BLOCK: [
    { code: "key-changes", label: "Ключевые изменения" },
    { code: "partners", label: "Партнёры и СК" },
    { code: "product", label: "Продукт и CJM" },
    { code: "risks", label: "Риски и решения" },
    { code: "team", label: "Команда и процессы" },
    // Команда уже ведёт эти блоки во вкладке Weekly CEO: открыты 05.10.2026
    { code: "numbers", label: "Цифры и прогноз" },
    { code: "traffic", label: "Трафик и маркетинг" },
  ],
  ENTRY_TYPE: [
    { code: "result", label: "Результат" },
    { code: "event", label: "Событие" },
    { code: "risk", label: "Риск" },
    { code: "plan", label: "План" },
  ],
  TASK_STATUS: [
    { code: "proposed", label: "Предложена", color: "outline" },
    { code: "in-progress", label: "В работе", color: "blue", isDefault: true },
    { code: "clarify", label: "Требует уточнений", color: "yellow" },
    { code: "done", label: "Выполнена", color: "green" },
    { code: "failed", label: "Не выполнена", color: "red" },
    { code: "cancelled", label: "Отменена", color: "gray" },
  ],
  PRIORITY: [
    { code: "critical", label: "Критичный", color: "red" },
    { code: "high", label: "Высокий", color: "orange" },
    { code: "medium", label: "Средний", color: "slate", isDefault: true },
    { code: "low", label: "Низкий", color: "gray" },
  ],
  TASK_STATE: [
    { code: "on-track", label: "В графике", color: "green", isDefault: true },
    { code: "at-risk", label: "Есть риск", color: "yellow" },
    { code: "blocked", label: "Заблокирована", color: "red" },
  ],
  WEEKLY_STATE: [
    { code: "not-started", label: "Не начат", color: "gray", isDefault: true },
    { code: "draft", label: "Черновик", color: "blue" },
    { code: "submitted", label: "Сдан", color: "green" },
    { code: "late", label: "Сдан с опозданием", color: "yellow" },
  ],
  TASK_SOURCE: [
    { code: "meeting", label: "Встреча" },
    { code: "weekly", label: "Запись weekly" },
    { code: "ceo", label: "Поручение CEO" },
    { code: "other", label: "Другое" },
  ],
};

type PersonSeed = {
  slug: string;
  fullName: string;
  shortName: string;
  role: Role;
  zone: string;
  direction: string;
  active?: boolean;
};

export const people: PersonSeed[] = [
  { slug: "muradyan", fullName: "Мурадян Арам", shortName: "Арам", role: "OWNER", zone: "Департамент целиком", direction: "department" },
  { slug: "golovkin", fullName: "Головкин Владислав", shortName: "Влад", role: "ADMIN", zone: "Департамент, ОСАГО", direction: "osago" },
  // Имя аналитика пока не известно, профиль выключен до уточнения
  { slug: "analyst", fullName: "Аналитик встречи", shortName: "Аналитик", role: "ADMIN", zone: "Протокол, задачи со встречи, порядок в данных", direction: "department", active: false },
  { slug: "reva", fullName: "Рева Тарас", shortName: "Тарас", role: "LEADER", zone: "Продукт и CJM по всем линиям", direction: "product" },
  { slug: "loginova", fullName: "Логинова Светлана", shortName: "Света", role: "LEADER", zone: "RED: ДВС, ипотека, ВЗР, ИФЛ", direction: "red" },
  { slug: "fatyanov", fullName: "Фатьянов Евгений", shortName: "Евгений Ф.", role: "LEADER", zone: "КАСКО", direction: "kasko" },
  { slug: "sakhibullina", fullName: "Сахибуллина Алсу", shortName: "Алсу", role: "LEADER", zone: "Партнёрский канал", direction: "partners" },
  { slug: "afanasyev", fullName: "Афанасьев Павел", shortName: "Павел", role: "LEADER", zone: "Партнёрский канал", direction: "partners" },
  { slug: "cheychenets", fullName: "Чейченец Евгений", shortName: "Евгений Ч.", role: "LEADER", zone: "Депозиты и инвестиции", direction: "deposits" },
  // CEO подключается наблюдателем только после персональных логинов (решение 04.10.2026)
  { slug: "ceo", fullName: "CEO", shortName: "CEO", role: "OBSERVER", zone: "Чтение", direction: "department", active: false },
];

export const settings: Record<string, unknown> = {
  "app.timezone": "Europe/Moscow",
  // Срок сдачи: понедельник после окончания недели, 18:00 по Москве
  "week.deadline": { weekday: 1, time: "18:00" },
  // Встреча команды во вторник
  "week.meeting": { weekday: 2 },
  "tasks.staleDays": 14,
  "tasks.nextNumber": 52,
  // ID копии таблицы Insurance&Invest Bord появится на этапе 6
  "sheet.spreadsheetId": null,
  "auth.team.login": "team",
  "auth.epoch": 1,
  "auth.managementEpoch": 1,
  "backup.keepDaily": 30,
  "backup.keepMonthly": 12,
};
