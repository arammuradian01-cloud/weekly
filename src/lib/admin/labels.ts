// Подписи настроек: ими пользуются и сервер (журнал), и экран.

import type { EditableDictKind } from "@/domain/dictionaries";

export const DICT_TITLES: Record<EditableDictKind, string> = {
  DIRECTION: "Направления",
  WEEKLY_BLOCK: "Блоки weekly",
  ENTRY_TYPE: "Типы записей",
  TASK_SOURCE: "Источники задач",
};

export const WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"];
