"use client";

import { useState } from "react";
import { changePasswordAction } from "@/app/(app)/profile/actions";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

/** Свой пароль (этап 20а): задать, если его ещё нет, или сменить с текущим. Другие устройства выйдут */
export function PasswordForm({ login, hasPassword }: { login: string; hasPassword: boolean }) {
  const run = useRunAction();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-4 flex max-w-md flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        const ok = await run(() => changePasswordAction(current, next, repeat), hasPassword ? "Пароль изменён, другие устройства вышли" : "Пароль задан");
        setBusy(false);
        if (ok !== null) {
          setCurrent("");
          setNext("");
          setRepeat("");
        }
      }}
    >
      <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />
      {hasPassword ? (
        <Field label="Текущий пароль" id="current-password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
      ) : null}
      <Field
        label="Новый пароль"
        id="new-password"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        hint="Не короче 10 символов, не только цифры, без логина, имени и фамилии"
        required
      />
      <Field label="Повторите новый пароль" id="repeat-password" type="password" autoComplete="new-password" value={repeat} onChange={(e) => setRepeat(e.target.value)} required />
      <div>
        <Button type="submit" size="sm" variant="secondary" disabled={busy || !next || !repeat || (hasPassword && !current)}>
          {hasPassword ? "Сменить пароль" : "Задать пароль"}
        </Button>
      </div>
    </form>
  );
}
