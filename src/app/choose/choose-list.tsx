"use client";

// Экран «Выберите себя» общего логина (этап 71): все включённые люди структуры без личного пароля, владельцы без пароля
// тоже (с подписью роли), но режима управления и прав владельца по общему логину нет.
// Людей несколько сотен: сразу видны первые 100 по алфавиту, остальных находит поиск по ФИО, должности и
// подразделению. Строка отправляет форму с номером человека, решает сервер (chooseProfile).

import { useState } from "react";
import { PeopleSearchField, PeopleSearchList, filterPeople, type SearchPerson } from "@/components/shell/people-search";

export function ChooseList({ people, current }: { people: SearchPerson[]; current: string | null }) {
  const [query, setQuery] = useState("");
  return (
    <div className="rounded-panel border border-line bg-surface">
      <PeopleSearchField
        id="choose-search"
        className="border-b border-line px-4 py-3 sm:px-5"
        value={query}
        onChange={setQuery}
        // Enter выбирает первого из найденных: та же отправка формы, что и нажатие на строку
        onEnter={(typed) => {
          const first = filterPeople(people, typed).shown[0];
          if (!first) return;
          document.querySelector<HTMLButtonElement>(`button[name="personId"][value="${CSS.escape(first.id)}"]`)?.click();
        }}
      />
      <div className="px-2 py-2 sm:px-3">
        <PeopleSearchList people={people} query={query} allText={(n) => `Можно выбрать: ${n}`} listLabel="Люди структуры" currentId={current} submitName="personId" />
      </div>
    </div>
  );
}
