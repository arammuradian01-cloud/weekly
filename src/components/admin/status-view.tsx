// Страница «Состояние» (этап 86): жива ли база, когда проверка проходила последний раз, какая версия собрана,
// какие сбои случились. Экран только читает: ничего не включает и ничего не меняет.
// Ни ключей, ни адресов с ключами здесь нет: про оповещения в Telegram видно только «настроены» или «не настроены».

import { Module, StatusLine, type StatusItem } from "@/components/ui/data";

export type StatusErrorView = {
  id: string;
  sourceLabel: string;
  message: string;
  place: string | null;
  stack: string | null;
  times: number;
  /** Когда случился последний раз, по Москве */
  at: string;
  /** Когда случился впервые, по Москве */
  firstAt: string;
};

export type StatusView = {
  /** Видит ли приложение базу прямо сейчас */
  db: boolean;
  /** Последняя удачная проверка: «12 мин назад» и точное время */
  lastOk: { ago: string; at: string } | null;
  /** Последняя неудачная проверка */
  lastFail: string | null;
  version: string;
  /** Настроены ли оповещения в Telegram */
  alerts: boolean;
  /** Политика CSP: действует, действует строго, только жалобы или выключена */
  csp: "on" | "strict" | "report-only" | "off";
  /** Значение HSTS или null, если заголовок не уходит (адрес http) */
  hsts: string | null;
  /** Разрешена ли перезаливка данных переменной окружения */
  reload: boolean;
  /** Зеркало в Google: идёт ли отбор по департаменту и по какому */
  mirror: { on: boolean; name: string | null };
  totals: { day: number; week: number; kinds: number };
  errors: StatusErrorView[];
};

const CSP_LABELS: Record<StatusView["csp"], string> = {
  on: "действует",
  strict: "действует строго, встроенные скрипты только с меткой",
  "report-only": "только жалобы, ничего не блокируется",
  off: "выключена",
};

export function StatusPanel({ view }: { view: StatusView }) {
  const items: StatusItem[] = [
    {
      label: "База",
      value: view.db ? "отвечает" : "не отвечает",
      tone: view.db ? "ok" : "danger",
      hint: view.lastOk ? `проверка ${view.lastOk.ago}` : "проверок ещё не было",
      testId: "status-db",
    },
    { label: "Версия сборки", value: view.version, testId: "status-version" },
    {
      label: "Сбои за сутки",
      value: view.totals.day ? `${view.totals.day}` : "нет",
      tone: view.totals.day ? "warning" : "ok",
      hint: view.totals.week ? `за неделю ${view.totals.week}` : undefined,
      testId: "status-errors-count",
    },
  ];
  return (
    <>
      <Module
        title="Проверки и версия"
        description="Проверку вызывает хостинг и внешний пинг из GitHub. Если приложение не отвечает, владельцу уходит сообщение в Telegram"
        params={[
          { label: "Последняя удачная проверка", value: view.lastOk ? view.lastOk.at : "ещё не было" },
          { label: "Последняя неудачная проверка", value: view.lastFail ?? "не было" },
          { label: "Версия собрана", value: view.version },
          { label: "Оповещения в Telegram", value: view.alerts ? "настроены" : "не настроены" },
        ]}
      >
        <StatusLine label="Состояние приложения" items={items} />
      </Module>

      <Module
        title="Защита"
        description="Заголовки безопасности и опасные действия. Меняются только переменными окружения на хостинге"
        params={[
          { label: "Политика CSP", value: CSP_LABELS[view.csp] },
          { label: "Только по https (HSTS)", value: view.hsts ? view.hsts : "не уходит: адрес http" },
          { label: "Перезаливка данных", value: view.reload ? "разрешена переменной RELOAD_ENABLED" : "закрыта" },
          { label: "Зеркало в Google", value: view.mirror.on ? `только департамент «${view.mirror.name}»` : "все департаменты" },
        ]}
      >
        <p className="text-small text-muted">
          Если после выкладки часть страницы перестала работать, политику можно перевести в режим жалоб: переменная CSP_MODE=report-only и перезапуск. Жалобы
          останутся в списке сбоев ниже.
        </p>
      </Module>

      <Module
        title="Сбои"
        description="Сбои сервера, браузера и жалобы политики в одном месте. Одинаковые сложены вместе, в записях нет содержимого задач и weekly"
        params={[{ label: "Разных сбоев", value: String(view.totals.kinds) }]}
      >
        {view.errors.length === 0 ? (
          <p className="text-body text-muted" data-testid="status-errors-empty">
            Сбоев нет.
          </p>
        ) : (
          <ul className="flex flex-col gap-3" data-testid="status-errors">
            {view.errors.map((e) => (
              <li key={e.id} className="rounded-card border border-border p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-caption text-muted">{e.sourceLabel}</span>
                  <span className="text-caption text-muted">{e.at}</span>
                  {e.times > 1 ? <span className="text-caption text-muted">раз: {e.times}</span> : null}
                </div>
                <p className="mt-1 break-words text-body text-ink">{e.message}</p>
                {e.place ? <p className="mt-1 break-words text-small text-muted">Где: {e.place}</p> : null}
                {e.stack ? <p className="mt-1 break-all text-caption text-muted">{e.stack}</p> : null}
                {e.times > 1 ? <p className="mt-1 text-caption text-muted">Впервые: {e.firstAt}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </Module>
    </>
  );
}
