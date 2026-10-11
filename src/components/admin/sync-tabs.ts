// Вкладки страницы синхронизации (этап 48). Отдельный модуль без "use client": константу читает и серверная
// страница, и клиентский экран, а из клиентского модуля на сервер приходит только ссылка, не массив
export const SYNC_TABS = ["bord", "numbers", "mirror"] as const;
export type SyncTab = (typeof SYNC_TABS)[number];
