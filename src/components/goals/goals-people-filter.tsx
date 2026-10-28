"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check } from "lucide-react";
import { cn } from "@/lib/cn";
import { NO_OWNER, NO_OWNER_LABEL, selectedLabels, selectionState, toggleSlug, type OwnerRef } from "@/lib/goals/by-person";
import { personOf } from "@/domain/people";

/**
 * Чьи цели показать: три взаимоисключающих состояния (все, мои, выбранные) и меню выбора нескольких людей.
 * «Выбранные» открывают меню: выбор набирают в нём. Отбор только среди владельцев уже доступных целей, новых прав он не даёт.
 * people и selected уже согласованы с целями квартала: человека, которого в них нет, здесь не будет
 */
export function GoalsPeopleFilter({ people, unowned, selected, me, mineAvailable, onChange }: {
  people: OwnerRef[];
  /** В квартале есть цели без владельца: они считаются целями руководителя команды */
  unowned: boolean;
  selected: string[];
  me: string;
  /** У человека есть свои цели в этом квартале */
  mineAvailable: boolean;
  onChange: (slugs: string[]) => void;
}) {
  const state = selectionState(selected, me);
  const labels = selectedLabels(selected, (slug) => people.find((p) => p.slug === slug)?.fullName ?? (slug === me ? "Я" : personOf(slug).fullName));
  const item = (active: boolean) => cn("sv-segment__item", active && "is-active");
  return (
    <div className="flex flex-col gap-2" data-testid="goals-people-filter">
      <div role="radiogroup" aria-label="Чьи цели" className="sv-segment sv-segment--touch max-w-full flex-wrap self-start">
        <button type="button" role="radio" aria-checked={state === "all"} className={item(state === "all")} onClick={() => onChange([])}>
          Все сотрудники
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={state === "mine"}
          className={item(state === "mine")}
          disabled={!mineAvailable}
          title={mineAvailable ? undefined : "У вас нет целей в этом квартале"}
          onClick={() => onChange([me])}
        >
          Мои цели
        </button>
        <Menu.Root>
          <Menu.Trigger asChild>
            {/* Радиокнопка, которая открывает меню: aria-expanded у radio не бывает, поэтому он снят */}
            <button type="button" role="radio" aria-checked={state === "picked"} aria-expanded={undefined} className={item(state === "picked")}>
              Выбранные
              {state === "picked" ? <span className="sv-counter sv-counter--neutral">{selected.length}</span> : null}
            </button>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content align="start" sideOffset={4} aria-label="Сотрудники" className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-control-lg border border-line bg-surface p-1.5 shadow-medium">
              <Menu.Label className="sv-menu__group">Можно выбрать нескольких</Menu.Label>
              {people.length ? null : <Menu.Label className="sv-menu__group">У целей этого квартала нет владельцев: выбирать некого</Menu.Label>}
              <Menu.Item disabled={!selected.length} onSelect={() => onChange([])} className="sv-menu__item cursor-pointer select-none font-semibold text-link outline-none data-[disabled]:cursor-not-allowed data-[disabled]:text-disabled data-[highlighted]:bg-field">
                Очистить выбор
              </Menu.Item>
              {people.map((person) => (
                <PersonItem key={person.slug} label={person.fullName} checked={selected.includes(person.slug)} onChange={(on) => onChange(toggleSlug(selected, person.slug, on))} />
              ))}
              {unowned ? (
                <>
                  {people.length ? <Menu.Separator className="sv-menu__sep" /> : null}
                  <PersonItem label={`${NO_OWNER_LABEL} (цели команд)`} checked={selected.includes(NO_OWNER)} onChange={(on) => onChange(toggleSlug(selected, NO_OWNER, on))} />
                </>
              ) : null}
            </Menu.Content>
          </Menu.Portal>
        </Menu.Root>
      </div>
      {!mineAvailable ? <p className="m-0 text-small text-muted">У вас нет целей в этом квартале, поэтому «Мои цели» недоступны</p> : null}
      {labels.length ? <p className="m-0 text-small text-muted" data-testid="goals-people-selected">Выбраны: {labels.join(", ")}</p> : null}
    </div>
  );
}

function PersonItem({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <Menu.CheckboxItem
      checked={checked}
      // Меню остаётся открытым: можно отметить нескольких
      onSelect={(event) => event.preventDefault()}
      onCheckedChange={onChange}
      className="sv-menu__item cursor-pointer select-none justify-between gap-2 outline-none data-[highlighted]:bg-field data-[state=checked]:font-semibold"
    >
      <span>{label}</span>
      <Menu.ItemIndicator>
        <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
      </Menu.ItemIndicator>
    </Menu.CheckboxItem>
  );
}
