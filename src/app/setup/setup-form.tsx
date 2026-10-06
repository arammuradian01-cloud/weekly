"use client";

import { useActionState } from "react";
import { completeSetup, type SetupState } from "@/app/actions/setup";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

const LABELS = {
  team: { title: "Общий вход для команды", hint: "Этот пароль вы раздадите команде вместе с логином team" },
  owner: { title: "Режим управления владельца", hint: "Только для вас" },
  admin: { title: "Режим управления администраторов", hint: "Для Головкина и аналитика встречи" },
} as const;

export function SetupForm({ missing }: { missing: ("team" | "owner" | "admin")[] }) {
  const [state, action, pending] = useActionState<SetupState, FormData>(completeSetup, null);
  return (
    <form action={action} className="flex flex-col gap-6">
      <Field
        label="Код настройки"
        id="token"
        name="token"
        type="text"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        required
        placeholder="XXXX-XXXX-XXXX-XXXX"
        hint="Строка «Код первичной настройки» в журнале запуска приложения в панели хостинга"
      />
      {missing.map((kind) => (
        <fieldset key={kind} className="flex flex-col gap-3 border-t border-line pt-5">
          <legend className="text-title-sm font-semibold text-ink">{LABELS[kind].title}</legend>
          <p className="-mt-1 text-small text-muted">{LABELS[kind].hint}. Не короче 12 символов.</p>
          <Field label="Пароль" id={kind} name={kind} type="password" autoComplete="new-password" required />
          <Field label="Ещё раз" id={`${kind}-repeat`} name={`${kind}-repeat`} type="password" autoComplete="new-password" required />
        </fieldset>
      ))}
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Сохраняем" : "Сохранить пароли"}
      </Button>
    </form>
  );
}
