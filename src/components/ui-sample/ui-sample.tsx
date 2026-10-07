"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { PRIORITIES, STATES, STATUSES, WEEKLY_STATES, ENTRY_TYPES } from "@/domain/dictionaries";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Chip, Segmented, SelectField, Skeleton, TextArea, TextInput, Avatar } from "@/components/ui/primitives";
import { Drawer, Modal } from "@/components/ui/overlays";
import { OverdueNote, PriorityTag, StaleNote, StateDot, StatusBadge, WeeklyBadge } from "@/components/ui/task-badges";
import { EmptyState } from "@/components/empty-state";
import { WeekStrip } from "@/components/brand/week-strip";
import { TaskTable } from "@/components/tasks/task-list";
import { EntryItem, EntryTypeBadge } from "@/components/weekly/entry-item";
import { DemoTaskActions, useTaskActions } from "@/components/tasks/task-actions";
import type { Task, WeeklyEntry } from "@/domain/types";
import { addDays } from "@/domain/dates";
import { SHADOWS, TEXT_SIZES, type TextSize } from "@/lib/design-tokens";

const COLORS = [
  { name: "Тёмно-синий", token: "navy", hex: "#002A3A", use: "Шапка, боковое меню, заголовки, основной текст" },
  { name: "Зелёный", token: "green", hex: "#0DD149", use: "Главная кнопка на экране, «выполнено». Текст на нём тёмно-синий" },
  { name: "Голубой", token: "blue", hex: "#00AFFF", use: "Выбранные элементы, «в работе», фокус" },
  { name: "Голубой для текста", token: "blue-700", hex: "#0073A8", use: "Ссылки: контраст на белом не ниже 4,5" },
  { name: "Светло-серый", token: "surface", hex: "#F3F6F8", use: "Фон карточек, шапки таблиц" },
  { name: "Линии", token: "line", hex: "#DCE4E8", use: "Границы, разделители" },
  { name: "Вторичный текст", token: "muted", hex: "#5A6E77", use: "Подписи, даты, пояснения" },
  { name: "Красный", token: "danger", hex: "#D93C41", use: "Просрочка, критичный приоритет, «заблокирована»" },
  { name: "Янтарный", token: "amber", hex: "#F2B600", use: "Точки «сдан с опозданием» и «под риском»" },
  { name: "Туман", token: "mist", hex: "#B4C2C9", use: "Точки «не начинал» и низкий приоритет" },
  { name: "Сталь", token: "steel", hex: "#90A4AE", use: "Пунктир «не задано»" },
  { name: "Оранжевый текст", token: "orange-ink", hex: "#9A4A05", use: "Высокий приоритет, оранжевая метка" },
];

const SWATCH: Record<string, string> = {
  navy: "bg-navy",
  green: "bg-green",
  blue: "bg-blue",
  "blue-700": "bg-blue-700",
  surface: "bg-field ring-1 ring-line",
  line: "bg-line",
  muted: "bg-muted",
  danger: "bg-danger",
  amber: "bg-amber",
  mist: "bg-mist",
  steel: "bg-steel",
  "orange-ink": "bg-orange-ink",
};

/** Где какой размер: подсказка для нового дизайна, значения в globals.css */
const TEXT_ROLES: Record<TextSize, string> = {
  micro: "Инициалы в маленьком кружке",
  tiny: "Мелкие пометки: адрес, число переносов, подписи меню",
  caption: "Подписи, даты, пояснения под полями",
  small: "Вторичный текст, ячейки таблиц, пункты меню",
  body: "Основной текст",
  lead: "Заголовок карточки, крупная строка в списке",
  "title-sm": "Заголовок блока в карточке",
  title: "Заголовок раздела на странице",
  "title-lg": "Крупный заголовок раздела",
  "headline-sm": "Имя на разборе задач, крупная цифра",
  headline: "Заголовок окна входа и страницы задачи на телефоне",
  page: "Заголовок страницы на телефоне",
  "headline-lg": "Крупные цифры синхронизации",
  "page-lg": "Заголовок страницы",
  "display-sm": "Режим встречи на телефоне",
  hero: "Главная фраза экрана входа",
  display: "Режим встречи на экране переговорной",
  card: "Заголовок карточки (роль дизайн-системы)",
  section: "Заголовок раздела (роль дизайн-системы)",
  "table-head": "Шапка таблицы (роль дизайн-системы)",
  number: "Крупные цифры и счётчики (роль дизайн-системы)",
};

const TEXT_CLASS: Record<TextSize, string> = {
  micro: "text-micro",
  tiny: "text-tiny",
  caption: "text-caption",
  small: "text-small",
  body: "text-body",
  lead: "text-lead",
  "title-sm": "text-title-sm",
  title: "text-title",
  "title-lg": "text-title-lg",
  "headline-sm": "text-headline-sm",
  headline: "text-headline",
  page: "text-page",
  "headline-lg": "text-headline-lg",
  "page-lg": "text-page-lg",
  "display-sm": "text-display-sm",
  hero: "text-hero",
  display: "text-display",
  card: "text-card",
  section: "text-section",
  "table-head": "text-table-head",
  number: "text-number",
};

const SHADOW_CLASS: Record<(typeof SHADOWS)[number], [string, string]> = {
  small: ["shadow-small", "Подсказки, календарь"],
  medium: ["shadow-medium", "Меню, окна, карточки при наведении"],
  sticky: ["shadow-sticky", "Залипающие панели"],
  menu: ["shadow-menu", "Выпадающее меню"],
  modal: ["shadow-modal", "Окно"],
  segment: ["shadow-segment", "Выбранный пункт переключателя"],
  toast: ["shadow-toast", "Уведомление внизу"],
  drag: ["shadow-drag", "Перетаскиваемая карточка"],
  drawer: ["shadow-drawer", "Боковая панель"],
};

function Block({ id, title, description, children }: { id: string; title: string; description?: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-t`} className="scroll-mt-24 border-t border-line py-8 first:border-t-0 first:pt-0">
      <h2 id={`${id}-t`} className="text-title-lg font-semibold text-ink">
        {title}
      </h2>
      {description ? <p className="mt-1 max-w-[70ch] text-small text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Выдуманные задачи образца: образец не трогает настоящие задачи команды */
function sampleTasks(today: string, me: Task["owner"]): Task[] {
  const base: Omit<Task, "number" | "title" | "outcome" | "status" | "state" | "priority" | "due" | "where"> = {
    owner: me,
    team: "top",
    coExecutors: [],
    direction: "department",
    whereUpdatedAt: today,
    originalDue: today,
    transfers: [],
    source: { kind: "other", note: "Образец" },
    links: [],
    comments: [],
    history: [],
    createdBy: null,
    createdAt: today,
    updatedAt: today,
  };
  return [
    { ...base, number: 901, title: "Пример: просроченная задача в работе", outcome: "Строка на бледно-красном фоне", status: "in-progress", state: "at-risk", priority: "high", due: addDays(today, -3), originalDue: addDays(today, -10), where: "Ждём ответа партнёра", transfers: [{ from: addDays(today, -10), to: addDays(today, -3), by: null, reason: "Пример переноса", at: addDays(today, -10) }] },
    { ...base, number: 902, title: "Пример: задача в графике со сроком на этой неделе", outcome: "Обычная строка", status: "in-progress", state: "on-track", priority: "medium", due: addDays(today, 2), where: "Черновик готов, показываем в четверг" },
    { ...base, number: 903, title: "Пример: выполненная задача", outcome: "Закрытая строка приглушена", status: "done", state: "on-track", priority: "low", due: addDays(today, -1), where: "Готово", resolution: "Итог: ссылка на результат", closedAt: addDays(today, -1) },
  ];
}

export function UiSample() {
  return (
    <DemoTaskActions>
      <UiSampleBody />
    </DemoTaskActions>
  );
}

function UiSampleBody() {
  const { data, me, notify } = usePrototype();
  const actions = useTaskActions();
  const [drawer, setDrawer] = useState(false);
  const [modal, setModal] = useState(false);
  const [seg, setSeg] = useState<"list" | "board">("list");
  const [chip, setChip] = useState(true);
  const sample = sampleTasks(data.today, me.slug);
  // Выдуманная запись: образец не трогает настоящий weekly
  const entry: WeeklyEntry = {
    id: "sample",
    week: data.today,
    author: me.slug,
    direction: "partners",
    block: "partners",
    type: "event",
    what: "Пример: партнёр готов к пилоту в ноябре",
    details: "Договорились о пилоте на двух регионах, ждём согласования тарифов.",
    fact: "2 региона",
    next: "Согласовать тарифы до пятницы",
    help: "Нужен контакт в андеррайтинге СК",
    links: [],
    ceo: false,
  };

  return (
    <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-10">
      <nav aria-label="Разделы образца" className="mb-6 hidden lg:block">
        <ul className="sticky top-24 flex flex-col gap-0.5 text-small">
          {[
            ["colors", "Цвета"],
            ["type", "Шрифт"],
            ["shadows", "Тени"],
            ["buttons", "Кнопки"],
            ["fields", "Поля"],
            ["badges", "Метки"],
            ["filters", "Фильтры"],
            ["table", "Таблица задач"],
            ["entry", "Запись weekly"],
            ["states", "Пустые и загрузка"],
            ["feedback", "Сохранено и отмена"],
            ["overlays", "Панель и диалог"],
            ["brand", "Фирменный знак"],
          ].map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`} className="block rounded-md px-2 py-1.5 text-muted hover:bg-field hover:text-ink">
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="min-w-0">
        <Block id="colors" title="Цвета" description="Все цвета задаются одним набором переменных в src/app/globals.css. Цвет никогда не единственный носитель смысла: рядом всегда есть слово.">
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {COLORS.map((c) => (
              <li key={c.token} className="rounded-xl ring-1 ring-line">
                <div className={`h-16 rounded-t-xl ${SWATCH[c.token]}`} aria-hidden="true" />
                <div className="px-3 py-2.5">
                  <p className="text-body font-semibold text-ink">{c.name}</p>
                  <p className="text-caption tabular-nums text-muted">{c.hex}</p>
                  <p className="mt-1 text-caption text-muted">{c.use}</p>
                </div>
              </li>
            ))}
          </ul>
        </Block>

        <Block
          id="type"
          title="Шрифт"
          description="Golos Text, он уже служит заменой фирменному Aeroport в презентациях. Размеры заданы по ролям в src/app/globals.css: класс text-caption, text-body и так далее. Числом размер в экранах не пишем, это проверяет тест."
        >
          <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
            {(Object.keys(TEXT_SIZES) as TextSize[]).map((name) => (
              <li key={name} className="grid gap-1 px-4 py-3 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-baseline sm:gap-4">
                <p className="text-caption tabular-nums text-muted">
                  text-{name}, {TEXT_SIZES[name]}
                </p>
                <p className={`${TEXT_CLASS[name]} truncate font-semibold leading-tight text-ink`}>{TEXT_ROLES[name]}</p>
              </li>
            ))}
          </ul>
          <p className="mt-3 max-w-[65ch] text-body leading-relaxed text-ink">
            Основной текст: строки не длиннее 80 знаков, чтобы глазу было удобно возвращаться к началу. Тексты простые и человеческие, без длинного тире и стрелок. Цифры в
            таблицах моноширинные: 12, 108, 1 254.
          </p>
        </Block>

        <Block id="shadows" title="Тени" description="Тени тоже токены: shadow-menu, shadow-modal и другие. Меняются в одном месте.">
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {SHADOWS.map((name) => (
              <li key={name} className={`rounded-xl bg-surface px-4 py-5 ${SHADOW_CLASS[name][0]}`}>
                <p className="text-body font-semibold text-ink">{SHADOW_CLASS[name][1]}</p>
                <p className="text-caption text-muted">{SHADOW_CLASS[name][0]}</p>
              </li>
            ))}
          </ul>
        </Block>

        <Block id="buttons" title="Кнопки" description="Зелёная кнопка одна на экране: главное действие. Высота не меньше 44 пикселей, на телефоне по всей ширине.">
          <div className="flex flex-wrap items-center gap-3">
            <Button>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Новая задача
            </Button>
            <Button variant="secondary">Перенести срок</Button>
            <Button variant="ghost">Отмена</Button>
            <Button disabled>Сдать weekly</Button>
            <Button size="sm">Маленькая</Button>
            <Button size="sm" variant="secondary">
              Маленькая вторичная
            </Button>
          </div>
        </Block>

        <Block id="fields" title="Поля" description="Подпись над полем, подсказка под ним, ошибка словами: что не так и как исправить.">
          <div className="grid max-w-3xl gap-4 sm:grid-cols-2">
            <TextInput label="Задача" id="ui-title" defaultValue="Подключить банк Д к витрине ОСАГО" hint="До 120 знаков, одна мысль" />
            <SelectField label="Приоритет" id="ui-pr" defaultValue="medium" options={PRIORITIES.map((p) => ({ value: p.code, label: p.label }))} />
            <TextArea label="Что произошло" id="ui-what" defaultValue="СК А прислала тарифы на годовой ВЗР" counter={{ value: 35, max: 150 }} className="sm:col-span-2" rows={2} />
            <TextInput label="Срок" id="ui-date" type="date" defaultValue={data.today} />
            <label className="inline-flex min-h-11 items-center gap-2 self-end text-body text-ink">
              <input type="checkbox" defaultChecked className="h-4 w-4 accent-blue-700" />
              Нужна помощь
            </label>
            <p role="alert" className="rounded-lg bg-danger-soft px-3.5 py-2.5 text-small text-danger-ink sm:col-span-2">
              Без причины перенести нельзя
            </p>
          </div>
        </Block>

        <Block id="badges" title="Метки" description="Статус, приоритет и состояние задачи, состояние weekly, тип записи, просрочка.">
          <dl className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <dt className="text-small text-muted">Статус</dt>
            <dd className="flex flex-wrap gap-2">
              {STATUSES.map((s) => (
                <StatusBadge key={s.code} status={s.code} />
              ))}
            </dd>
            <dt className="text-small text-muted">Приоритет</dt>
            <dd className="flex flex-wrap gap-4">
              {PRIORITIES.map((p) => (
                <PriorityTag key={p.code} priority={p.code} />
              ))}
            </dd>
            <dt className="text-small text-muted">Состояние</dt>
            <dd className="flex flex-wrap gap-4">
              {STATES.map((s) => (
                <StateDot key={s.code} state={s.code} />
              ))}
            </dd>
            <dt className="text-small text-muted">Weekly</dt>
            <dd className="flex flex-wrap gap-2">
              {WEEKLY_STATES.map((s) => (
                <WeeklyBadge key={s.code} state={s.code} />
              ))}
            </dd>
            <dt className="text-small text-muted">Тип записи</dt>
            <dd className="flex flex-wrap gap-2">
              {ENTRY_TYPES.map((t) => (
                <EntryTypeBadge key={t.code} type={t.code} />
              ))}
            </dd>
            <dt className="text-small text-muted">Сроки</dt>
            <dd className="flex flex-wrap items-center gap-4">
              <OverdueNote days={3} />
              <StaleNote />
              <Badge tone="navy">Владелец</Badge>
              <span className="inline-flex items-center gap-2 text-small text-ink">
                <Avatar text="ВГ" size="sm" /> Влад
              </span>
            </dd>
          </dl>
        </Block>

        <Block id="filters" title="Фильтры и переключатели" description="Быстрый фильтр включается одним нажатием и показывает, сколько под ним задач.">
          <div className="flex flex-wrap items-center gap-3">
            <Chip active={chip} onClick={() => setChip((v) => !v)} count={10}>
              Мои
            </Chip>
            <Chip active={false} onClick={() => undefined} count={7} tone="danger">
              Просроченные
            </Chip>
            <Segmented
              label="Вид"
              value={seg}
              onChange={setSeg}
              options={[
                { value: "list", label: "Список" },
                { value: "board", label: "Доска" },
              ]}
            />
          </div>
        </Block>

        <Block id="table" title="Таблица задач" description="Статус, состояние и приоритет меняются в строке в один клик. Просроченная строка целиком на бледно-красном фоне с подписью «просрочена на N дн.».">
          <TaskTable groups={[{ key: "sample", title: "", tasks: sample }]} onOpen={() => notify("Это образец: у настоящих задач здесь открывается карточка")} />
        </Block>

        <Block id="entry" title="Запись weekly" description="Одна запись равна одному событию. Запрос помощи подсвечен и поднимается наверх ленты.">
          <div className="max-w-2xl rounded-xl px-5 py-4 ring-1 ring-line">
            <EntryItem entry={entry} showAuthor demo />
          </div>
        </Block>

        <Block id="states" title="Пустые состояния и загрузка" description="Пустой экран говорит, что делать дальше. Пока данные грузятся, вместо них серые блоки той же формы.">
          <div className="grid gap-4 xl:grid-cols-2">
            <EmptyState title="Под эти фильтры задач нет">Снимите часть фильтров или поищите по номеру задачи.</EmptyState>
            <div role="group" className="flex flex-col gap-3 rounded-xl px-5 py-4 ring-1 ring-line" aria-label="Пример загрузки">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <div className="flex gap-3">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-24" />
                <Skeleton className="h-6 w-16" />
              </div>
            </div>
          </div>
        </Block>

        <Block id="feedback" title="«Сохранено» и отмена" description="После каждой правки внизу появляется «Сохранено». Последнее действие можно отменить 5 секунд.">
          <Button variant="secondary" onClick={() => actions.changePriority(sample[0]!, sample[0]!.priority === "high" ? "critical" : "high")}>
            Поменять приоритет задачи {sample[0]!.number}
          </Button>
        </Block>

        <Block id="overlays" title="Боковая панель и диалог" description="Карточка задачи открывается боковой панелью. Перенос срока и закрытие задачи спрашивают причину в диалоге.">
          <div className="flex flex-wrap gap-3">
            <Button variant="secondary" onClick={() => setDrawer(true)}>
              Открыть боковую панель
            </Button>
            <Button variant="secondary" onClick={() => setModal(true)}>
              Открыть диалог
            </Button>
            <Button variant="secondary" onClick={() => actions.transfer(sample[1]!)}>
              Перенести срок задачи {sample[1]!.number}
            </Button>
          </div>
          <Drawer open={drawer} onOpenChange={setDrawer} title="Боковая панель" description="Закрывается крестиком, клавишей Esc и щелчком мимо">
            <p className="text-body text-ink">Здесь открывается карточка задачи со всеми полями, комментариями и историей.</p>
          </Drawer>
          <Modal open={modal} onOpenChange={setModal} title="Диалог" description="Короткий вопрос с понятными кнопками">
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setModal(false)}>
                Отмена
              </Button>
              <Button onClick={() => setModal(false)}>Понятно</Button>
            </div>
          </Modal>
        </Block>

        <Block id="brand" title="Фирменный знак" description="Параллелограмм Сравни только как декор: экран входа, шапки разделов, пустые состояния. В рабочих таблицах и формах его нет.">
          <div className="-mx-2 max-w-xl">
            <WeekStrip
              days={["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d, i) => ({ key: d, weekday: d, date: 28 + i > 30 ? i - 2 : 28 + i, state: i < 3 ? "past" : i === 3 ? "today" : "future" }))}
              deadline={{ weekday: "Пн", date: 5, time: "18:00" }}
            />
          </div>
        </Block>
      </div>
    </div>
  );
}
