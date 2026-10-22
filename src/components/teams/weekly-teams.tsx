"use client";

// Экран «Weekly-команды» (этап 64). Решение Арама 22.10: один экран вместо вкладки «Команды» в «Структуре» и
// «Weekly-проектов». Слева список команд с поиском по названию и людям, справа карточка выбранной команды: состав,
// ждущие согласия, руководитель, сдача weekly. На телефоне карточка открывается отдельным экраном. Выбранная команда
// живёт в адресе (?team=): ссылкой на карточку можно поделиться, переход на вкладку возвращает к списку.
// Перетаскивание подразделений и людей осталось помощником «Собрать из структуры», свёрнутым по умолчанию.

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { Plus, RefreshCw, Search, Users } from "lucide-react";
import type { WeeklyTeam, WeeklyTeamsView } from "@/lib/org/teams";
import { managementHint, matchTeam, sizeText, teamKindLabel, teamSize } from "@/lib/org/team-rights";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { Button, buttonClass } from "@/components/ui/button";
import { Collapsible } from "@/components/ui/collapsible";
import { EmptyState } from "@/components/empty-state";
import { useRunWeekly } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";
import { decideJoinAction, reopenTeamAction, syncTeamsAction } from "@/app/(app)/people/teams/actions";
import type { JoinRequestView } from "@/lib/org/service";
import { TeamCard, type CardAction } from "./team-card";
import { WeeklyLine } from "./weekly-line";
import { AddPeopleModal, CloseModal, CreateTeamModal, LeaderModal, RenameModal, RhythmModal } from "./team-dialogs";
import { StructureAssembler } from "./structure-assembler";
import { ManageHint } from "./manage-hint";

/** Телефон и узкий ноутбук: карточка вместо списка, а не рядом с ним */
const NARROW = "(max-width: 1023.98px)";

function intro(view: WeeklyTeamsView): string {
  if (view.mode === "shared") return "Под общим входом команды только для просмотра. Чтобы управлять своей командой, войдите со своим логином и паролем.";
  if (view.mode === "all")
    return view.owner
      ? "Все weekly-команды компании. В режиме управления вы меняете состав любой команды, люди других веток входят сразу."
      : "Все weekly-команды компании. Состав меняют руководитель команды и владелец в режиме управления.";
  if (view.canCreate || view.teams.some((t) => t.rights.members || t.rights.rhythm))
    return "Ваши команды по структуре и проекты, команды ниже ваших и команды, где вы участник. Люди вашей ветки входят сразу, из других веток после согласия их руководителя.";
  return "Команды, в которых вы участник. Состав меняет руководитель команды.";
}

function TeamRow({ team, selected, onOpen }: { team: WeeklyTeam; selected: boolean; onOpen: (id: string) => void }) {
  const who = team.relation === "leader" ? "Руководитель: вы" : team.leader ? `Руководитель: ${team.leader.fullName}` : "Руководитель не назначен";
  const tail = team.relation === "member" ? ", вы участник" : team.relation === "below" ? ", команда ниже вашей" : "";
  return (
    <li>
      <a
        href={`/people/teams?team=${encodeURIComponent(team.id)}`}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(team.id);
        }}
        aria-current={selected ? "true" : undefined}
        className={cn("flex flex-col gap-1 px-4 py-3 outline-none hover:bg-row-hover focus-visible:bg-row-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus", selected && "bg-row-selected hover:bg-row-selected")}
        data-testid={`team-row-${team.id}`}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-words text-body font-semibold text-ink">{team.name}</span>
          <Badge tone={team.kind === "CUSTOM" ? "blue" : "gray"}>{teamKindLabel(team)}</Badge>
        </span>
        <span className="text-small text-muted">
          {who}, {sizeText(teamSize(team))}
          {tail}
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <WeeklyLine weekly={team.weekly} />
          {team.waiting.length ? <span className="text-small font-medium text-warning-ink">Ждут согласия: {team.waiting.length}</span> : null}
        </span>
      </a>
    </li>
  );
}

/** Ваших сотрудников зовут в команды других веток (этап 53): решаете вы */
function JoinRequests({ list }: { list: JoinRequestView[] }) {
  const run = useRunWeekly();
  const [busy, setBusy] = useState(false);
  const decide = async (r: JoinRequestView, approve: boolean) => {
    setBusy(true);
    await run(() => decideJoinAction(r.id, approve), approve ? `${r.person.fullName} в команде «${r.team.name}»` : "Запрос отклонён");
    setBusy(false);
  };
  return (
    <section id="join-requests" aria-labelledby="join-requests-title" className="sv-card sv-card--soft scroll-mt-24 p-4" data-testid="join-requests">
      <h2 id="join-requests-title" className="text-title-sm font-semibold text-ink">
        Ваших сотрудников зовут в команды: {list.length}
      </h2>
      <p className="mt-1 text-small text-muted">Участник команды видит weekly и задачи коллег по ней, а они его. Согласитесь, если человек действительно будет работать с этой командой.</p>
      <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
        {list.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-body text-ink">
              <span className="font-semibold">{r.person.fullName}</span> в команду «{r.team.name}»{r.requestedBy ? <span className="text-muted">, просит {r.requestedBy}</span> : null}
            </p>
            <div className="flex gap-2">
              <Button size="sm" className="max-sm:min-h-11" disabled={busy} onClick={() => void decide(r, true)}>
                Согласовать
              </Button>
              <Button size="sm" variant="secondary" className="max-sm:min-h-11" disabled={busy} onClick={() => void decide(r, false)}>
                Отказать
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Focus = { to: "card" } | { to: "row"; id: string };

export function WeeklyTeams({ view }: { view: WeeklyTeamsView }) {
  const pathname = usePathname();
  // Выбор берётся из адреса: переход на вкладку «Weekly-команды» (без команды) возвращает к списку
  const picked = useSearchParams().get("team");
  const run = useRunWeekly();
  const { notify } = usePrototype();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [dialog, setDialog] = useState<{ action: CardAction; team: WeeklyTeam } | null>(null);
  const [busy, setBusy] = useState(false);
  // Карточку, открытую из списка, мы положили в историю шагом: «К списку команд» тогда равна кнопке «Назад».
  // Помним это здесь, а не в history.state: обновление данных роутером переписывает state записи
  const pushedRef = useRef<string | null>(null);
  // Куда поставить фокус после смены экрана: на заголовок карточки или обратно на строку списка
  const focusRef = useRef<Focus | null>(null);

  useEffect(() => {
    const onPop = () => {
      // Системная «Назад» с карточки: к списку, фокус на строку команды
      if (pushedRef.current) focusRef.current = { to: "row", id: pushedRef.current };
      pushedRef.current = null;
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // Карточка: выбранная команда, иначе на ноутбуке первая в списке. На телефоне без выбора только список
  const selected = picked ? (view.teams.find((t) => t.id === picked) ?? (view.extra?.id === picked ? view.extra : null)) : null;
  const shown = selected ?? view.teams[0] ?? null;
  const cardMode = !!selected;

  useEffect(() => {
    const f = focusRef.current;
    if (!f) return;
    const el = f.to === "card" ? document.getElementById("team-card-title") : document.querySelector<HTMLElement>(`[data-testid="team-row-${f.id}"]`);
    // Элемент ещё не на экране (данные новой команды не пришли): попробуем после следующего обновления
    if (!el || !el.getClientRects().length) return;
    focusRef.current = null;
    el.focus({ preventScroll: f.to === "row" ? false : true });
  }, [selected, view]);

  const found = useMemo(() => view.teams.filter((t) => matchTeam(t, query)), [view.teams, query]);
  const targets = useMemo(() => {
    const own = view.teams.filter((t) => t.rights.members && t.relation === "leader");
    // Владелец выбрал чужую команду: помощник добавляет и в неё
    if (shown?.rights.members && !own.some((t) => t.id === shown.id)) return [shown, ...own];
    return own;
  }, [view.teams, shown]);
  const assemble = view.people.length > 0 && (targets.length > 0 || view.canCreate);
  const hint = managementHint(view.managementOff);

  /**
   * Открыть карточку. Из списка шаг в истории (на телефоне «Назад» вернёт к списку), из открытой карточки замена:
   * перебор команд на ноутбуке не копит историю. Адрес меняется через history: роутер Next подхватывает его сразу,
   * а обновление данных после действия, начатое раньше, отменяется переходом и повторяется уже по новому адресу
   */
  const open = (id: string) => {
    if (picked === id) return;
    const url = `${pathname}?team=${encodeURIComponent(id)}`;
    if (picked) window.history.replaceState(null, "", url);
    else {
      window.history.pushState(null, "", url);
      pushedRef.current = id;
    }
    focusRef.current = { to: "card" };
    if (window.matchMedia(NARROW).matches) window.scrollTo({ top: 0 });
  };
  /** К списку: если карточку открыли из списка, это шаг назад по истории, иначе адрес без команды */
  const back = () => {
    if (picked) focusRef.current = { to: "row", id: picked };
    if (pushedRef.current && pushedRef.current === picked) {
      pushedRef.current = null;
      window.history.back();
      return;
    }
    pushedRef.current = null;
    window.history.replaceState(null, "", pathname);
  };
  const act = (action: CardAction) => {
    if (shown) setDialog({ action, team: shown });
  };

  const sync = async () => {
    setBusy(true);
    const r = await run(() => syncTeamsAction());
    setBusy(false);
    if (r) notify(r.teams ? `Команд по структуре создано: ${r.teams}, участников добавлено: ${r.members}` : "Команды руководителей подразделений проверены");
  };
  const reopen = async (id: string, name: string) => {
    setBusy(true);
    await run(() => reopenTeamAction(id), `Команда «${name}» снова работает`);
    setBusy(false);
  };

  const empty = !view.teams.length;
  return (
    <div className="flex flex-col gap-5">
      <div className={cn("flex-col gap-5", cardMode ? "hidden lg:flex" : "flex")}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 className="text-title font-semibold text-ink">Weekly-команды</h2>
            <p className="mt-1 max-w-[80ch] text-small text-muted">{intro(view)}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {view.owner ? (
              <Button variant="secondary" size="sm" className="max-sm:min-h-11" disabled={busy} onClick={() => void sync()}>
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Создать команды по структуре
              </Button>
            ) : null}
            {view.canCreate ? (
              <Button onClick={() => setCreating(true)} data-testid="team-create">
                <Plus className="h-5 w-5" aria-hidden="true" />
                Создать команду
              </Button>
            ) : null}
          </div>
        </div>

        {hint ? <ManageHint text={hint} /> : null}

        {view.toApprove.length ? <JoinRequests list={view.toApprove} /> : null}

        {assemble ? (
          <Collapsible id="assemble" title="Собрать из структуры" hint="Перетащите подразделение или людей в свою команду" testId="assemble">
            <StructureAssembler units={view.units} persons={view.people} targets={targets} canCreate={view.canCreate} direct={view.owner} me={view.me} onCreateEmpty={() => setCreating(true)} onDone={open} />
          </Collapsible>
        ) : null}
      </div>

      <div className={cn("grid gap-5", shown && "lg:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]")}>
        <section aria-label="Список команд" className={cn("min-w-0 flex-col gap-3", cardMode ? "hidden lg:flex" : "flex")}>
          {empty ? (
            view.canCreate ? (
              <EmptyState title="Weekly-команд пока нет" icon={Users} tone="accent" centered action={<Button onClick={() => setCreating(true)}>Создать команду</Button>}>
                Соберите команду из людей любых подразделений: у неё будет своё weekly и свои задачи.
              </EmptyState>
            ) : (
              <EmptyState
                title="Вы пока не в weekly-команде"
                icon={Users}
                centered
                action={
                  <Link href="/people/structure" className={buttonClass("secondary", "sm", "max-sm:min-h-11")}>
                    Открыть структуру
                  </Link>
                }
              >
                {view.mode === "shared" ? "Под общим входом видна только топ-команда. Войдите со своим логином и паролем, чтобы увидеть свои команды." : "В команду добавляет её руководитель. Пока можно посмотреть, кто с кем работает, в структуре компании."}
              </EmptyState>
            )
          ) : (
            <>
              {view.teams.length > 3 ? (
                <div className="sv-field">
                  <label htmlFor="teams-search" className="sv-label">
                    Найти команду или человека
                  </label>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-icon" aria-hidden="true" />
                    <input id="teams-search" type="search" className="sv-control w-full pl-9" autoComplete="off" placeholder="Название команды, руководитель или участник" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                </div>
              ) : null}
              {found.length ? (
                <ul className="sv-card m-0 list-none divide-y divide-line overflow-hidden bg-surface p-0" aria-label="Weekly-команды" data-testid="teams-list">
                  {found.map((t) => (
                    <TeamRow key={t.id} team={t} selected={shown?.id === t.id} onOpen={open} />
                  ))}
                </ul>
              ) : (
                <p className="sv-card bg-surface p-4 text-small text-muted" aria-live="polite">
                  Ничего не нашли: проверьте написание или очистите поиск
                </p>
              )}
            </>
          )}
          {view.closed.length ? (
            <Collapsible id="closed-teams" title="Закрытые команды" hint={`${view.closed.length}: можно вернуть`} headingLevel={3} testId="closed-teams">
              <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
                {view.closed.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0 text-body text-ink">{t.name}</span>
                    <Button size="sm" variant="secondary" className="max-sm:min-h-11" disabled={busy} onClick={() => void reopen(t.id, t.name)} aria-label={`Вернуть команду: ${t.name}`}>
                      Вернуть
                    </Button>
                  </li>
                ))}
              </ul>
            </Collapsible>
          ) : null}
        </section>
        {shown ? (
          <aside aria-label="Карточка команды" className={cn("min-w-0 self-start lg:sticky lg:top-20", cardMode ? "block" : "hidden lg:block")}>
            <TeamCard key={shown.id} team={shown} view={view} onAction={act} onBack={back} />
          </aside>
        ) : null}
      </div>

      <CreateTeamModal open={creating} onOpenChange={setCreating} all={view.people} me={view.me} direct={view.owner} managementOff={view.managementOff} onCreated={open} />
      {dialog?.action === "add" ? <AddPeopleModal team={dialog.team} all={view.people} direct={view.owner} onClose={() => setDialog(null)} /> : null}
      {dialog?.action === "rename" ? <RenameModal team={dialog.team} onClose={() => setDialog(null)} /> : null}
      {dialog?.action === "close" ? (
        <CloseModal
          team={dialog.team}
          onClose={() => setDialog(null)}
          onClosed={() => {
            pushedRef.current = null;
            window.history.replaceState(null, "", pathname);
          }}
        />
      ) : null}
      {dialog?.action === "leader" ? <LeaderModal team={dialog.team} all={view.people} owners={view.owners} parents={view.parents} onClose={() => setDialog(null)} /> : null}
      {dialog?.action === "rhythm" ? <RhythmModal team={dialog.team} onClose={() => setDialog(null)} /> : null}
    </div>
  );
}
