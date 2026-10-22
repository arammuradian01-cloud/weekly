"use client";

// «О себе» (этап 80): несколько строк о себе, чем могу помочь коллегам и ник в Telegram. Видят все коллеги в карточке
// человека. person: чьи тексты правит владелец в режиме управления; без него свои

import { useState } from "react";
import { saveAboutAction } from "@/app/(app)/profile/actions";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { TextArea, TextInput } from "@/components/ui/primitives";
import { ABOUT_MAX, HELP_MAX, parseAbout, type ProfileAbout } from "@/lib/profile/rules";

type Draft = { about: string; helpWith: string; telegram: string };

const draftOf = (v: ProfileAbout): Draft => ({ about: v.about ?? "", helpWith: v.helpWith ?? "", telegram: v.telegram ? `@${v.telegram}` : "" });

export function AboutForm({
  person = null,
  initial,
  locked = null,
  onSaved,
  idPrefix = "about",
}: {
  person?: string | null;
  initial: ProfileAbout;
  /** Почему менять нельзя (общий логин, просмотр): поля только для чтения и причина */
  locked?: string | null;
  onSaved?: (value: ProfileAbout) => void;
  idPrefix?: string;
}) {
  const run = useRunAction();
  const [saved, setSaved] = useState(() => draftOf(initial));
  const [draft, setDraft] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const changed = draft.about !== saved.about || draft.helpWith !== saved.helpWith || draft.telegram !== saved.telegram;
  const set = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setDraft({ ...draft, [key]: e.target.value });
    setError(undefined);
  };

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy || locked) return;
        // Та же проверка, что на сервере: ник и длина видны сразу, без запроса
        const parsed = parseAbout(draft);
        if (!parsed.ok) {
          setError(parsed.error);
          return;
        }
        setBusy(true);
        const value = await run(() => saveAboutAction(person, draft), "Сохранено");
        setBusy(false);
        if (value) {
          const next = draftOf(value);
          setSaved(next);
          setDraft(next);
          onSaved?.(value);
        }
      }}
    >
      <fieldset disabled={!!locked || busy} className="flex flex-col gap-4">
        <legend className="sr-only">О себе</legend>
        <TextArea
          id={`${idPrefix}-text`}
          label="О себе"
          rows={4}
          maxLength={ABOUT_MAX}
          value={draft.about}
          onChange={set("about")}
          counter={{ value: draft.about.length, max: ABOUT_MAX }}
          placeholder="Чем занимаетесь, с какими продуктами и командами работаете, в чём разбираетесь"
          hint={`До ${ABOUT_MAX} знаков, можно в несколько строк. Это поле видят все коллеги.`}
        />
        <TextArea
          id={`${idPrefix}-help`}
          label="Чем могу помочь коллегам"
          rows={3}
          maxLength={HELP_MAX}
          value={draft.helpWith}
          onChange={set("helpWith")}
          counter={{ value: draft.helpWith.length, max: HELP_MAX }}
          placeholder="Например: подскажу по тарифам ОСАГО, помогу собрать выгрузку из CRM"
          hint={`Необязательно, до ${HELP_MAX} знаков. Это поле видят все коллеги.`}
        />
        <TextInput
          id={`${idPrefix}-telegram`}
          label="Telegram"
          value={draft.telegram}
          onChange={set("telegram")}
          placeholder="@ник"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          hint="Необязательно. Ник вида @name: в карточке станет ссылкой, по ней коллеги напишут вам. Ник видят все коллеги."
        />
      </fieldset>
      {locked ? <p className="text-small text-muted">{locked}</p> : null}
      <FormError message={error} />
      {locked ? null : (
        <div>
          <Button type="submit" size="sm" variant="secondary" disabled={!changed || busy} loading={busy} data-testid={`${idPrefix}-save`}>
            Сохранить
          </Button>
        </div>
      )}
    </form>
  );
}
