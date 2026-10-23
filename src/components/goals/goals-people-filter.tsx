"use client";

import * as Menu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/primitives";

/** [Codex] Отбор только среди владельцев уже доступных целей: новых прав он не даёт. */
export function GoalsPeopleFilter({ people, selected, me, onChange }: {
  people: { slug: string; fullName: string }[];
  selected: string[];
  me: string;
  onChange: (slugs: string[]) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Чьи цели">
      <Chip active={!selected.length} onClick={() => onChange([])}>Все сотрудники</Chip>
      <Chip active={selected.length === 1 && selected[0] === me} onClick={() => onChange([me])}>Мои цели</Chip>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button size="sm" variant="secondary">
            Выбрать сотрудников{selected.length ? ` (${selected.length})` : ""}
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="start" sideOffset={4} aria-label="Сотрудники" className="z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-control-lg border border-line bg-surface p-1.5 shadow-medium">
            <Menu.Label className="sv-menu__group">Можно выбрать нескольких</Menu.Label>
            {people.map((person) => (
              <Menu.CheckboxItem key={person.slug} checked={selected.includes(person.slug)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(checked) => onChange(checked ? [...selected, person.slug] : selected.filter((slug) => slug !== person.slug))}
                className="sv-menu__item cursor-pointer select-none justify-between gap-2 outline-none data-[highlighted]:bg-field data-[state=checked]:font-semibold">
                <span>{person.fullName}</span>
                <Menu.ItemIndicator><Check className="h-4 w-4 shrink-0" aria-hidden="true" /></Menu.ItemIndicator>
              </Menu.CheckboxItem>
            ))}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>
      {selected.length ? <p className="m-0 w-full text-small text-muted">Выбраны: {selected.map((slug) => people.find((p) => p.slug === slug)?.fullName ?? "Я").join(", ")}</p> : null}
    </div>
  );
}
