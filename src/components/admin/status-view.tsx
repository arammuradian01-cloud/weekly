// Страница «Состояние» (этап 86): жива ли база, когда проверка проходила последний раз, какая версия собрана,
// какие сбои случились. Экран только читает: ничего не включает и ничего не меняет.
// Ни ключей, ни адресов с ключами здесь нет: про оповещения в Telegram видно только «настроены» или «не настроены».

import { Module, StatusLine, type StatusItem } from "@/components/ui/data";
import { ClearErrors } from "@/components/admin/status-clear";
import type { BackupStatus } from "@/lib/backup-status";

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
  /** Последняя удачная проверка: «12 мин назад», точное время и признак «давно не приходили» */
  lastOk: { ago: string; at: string; stale: boolean } | null;
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
  backups: BackupStatus;
  totals: { day: number; week: number; kinds: number };
  /** Сбои сервера: приходят из onRequestError, подделать их снаружи нельзя */
  server: StatusErrorView[];
  /** Сбои браузера и жалобы политики: приходят в открытый обработчик, текст в них задаёт кто угодно */
  outside: StatusErrorView[];
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
      testId: "status-db",
    },
    // Проверки приходят снаружи: от внешнего пинга и от проверки состояния хостинга. Если они перестали
    // приходить, об этом нужно сказать прямо: иначе наблюдения нет, а выглядит как будто всё хорошо
    {
      label: "Последняя проверка",
      value: view.lastOk ? view.lastOk.ago : "не приходили",
      tone: !view.lastOk || view.lastOk.stale ? "warning" : "ok",
      hint: view.lastOk?.stale ? "проверки давно не приходили: посмотрите внешний пинг" : undefined,
      testId: "status-check",
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
        title="Резервные копии"
        description="Зашифрованные копии во внешнем хранилище. Восстановление проверяется на отдельном сервере"
        params={[
          { label: "Последняя подтверждённая копия", value: view.backups.copyAt ?? "ещё не было" },
          { label: "Последнее проверенное восстановление", value: view.backups.checkAt ?? "ещё не было" },
          { label: "Последний сбой копирования", value: view.backups.copyFailedAt ?? "не было" },
          { label: "Последний сбой восстановления", value: view.backups.checkFailedAt ?? "не было" },
        ]}
      >
        <StatusLine label="Состояние резервирования" items={[
          { label: "Внешняя копия", value: !view.backups.enabled ? "выключена" : view.backups.copyStale ? "требует проверки" : "подтверждена",
            tone: !view.backups.enabled || view.backups.copyStale ? "warning" : "ok", testId: "status-backup",
            hint: view.backups.enabled && view.backups.copyStale ? "нет свежей копии за 36 часов или последняя попытка не прошла" : undefined },
          { label: "Проверка восстановления", value: !view.backups.enabled || !view.backups.restoreEnabled ? "выключена" : view.backups.checkStale ? "требует проверки" : "пройдена",
            tone: !view.backups.enabled || !view.backups.restoreEnabled || view.backups.checkStale ? "warning" : "ok", testId: "status-backup-restore" },
        ]} />
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

      {/* Два списка, а не один: иначе поток сообщений в открытый обработчик выдавливал бы настоящие сбои сервера
          из общего списка, и содержимое главного экрана наблюдения задавал бы посторонний (замечание ревью) */}
      <Module
        title="Сбои сервера"
        description="Приходят изнутри ресурса, из обработчика ошибок Next. Одинаковые сложены вместе, содержимого задач и weekly в записях нет"
        params={[{ label: "Разных сбоев всего", value: String(view.totals.kinds) }]}
      >
        {view.server.length === 0 ? (
          <p className="text-body text-muted" data-testid="status-errors-server-empty">
            Сбоев сервера нет.
          </p>
        ) : (
          <ErrorList items={view.server} testId="status-errors-server" />
        )}
      </Module>

      <Module
        title="Сбои браузера и жалобы политики"
        description="Их присылает браузер на открытый адрес /api/errors, поэтому текст в них может прийти и со стороны. Оповещения по ним не уходят"
        actions={<ClearErrors count={view.server.length + view.outside.length} />}
      >
        {view.outside.length === 0 ? (
          <p className="text-body text-muted" data-testid="status-errors-empty">
            Сбоев нет.
          </p>
        ) : (
          <ErrorList items={view.outside} testId="status-errors" />
        )}
      </Module>
    </>
  );
}

function ErrorList({ items, testId }: { items: StatusErrorView[]; testId: string }) {
  return (
    <ul className="flex flex-col gap-3" data-testid={testId}>
      {items.map((e) => (
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
  );
}
