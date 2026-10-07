"use client";

import { useActionState, useState } from "react";
import { consumeLinkAction, setPasswordAction, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

/** Вход по ссылке без пароля: только для ссылки из письма (этап 9) */
export function LinkLoginForm({ token, fullName, secondary }: { token: string; fullName: string; secondary?: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(consumeLinkAction, null);
  return (
    <form action={action} className="mt-3 flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <FormError message={state?.error} />
      <Button type="submit" variant={secondary ? "ghost" : "primary"} disabled={pending} className="w-full" aria-label={`Войти как ${fullName}`}>
        {pending ? "Входим" : secondary ? "Войти без пароля" : "Войти"}
      </Button>
    </form>
  );
}

/**
 * Личный пароль по ссылке (этап 20а): человек придумывает пароль сам и сразу входит. Пароль не проходит ни через
 * владельца, ни через переписку. Дальше вход по логину и паролю на экране входа
 */
export function SetPasswordForm({ token, login, reset }: { token: string; login: string; reset: boolean }) {
  const [state, action, pending] = useActionState<FormState, FormData>(setPasswordAction, null);
  const [show, setShow] = useState(false);
  return (
    <form action={action} className="mt-6 flex flex-col gap-4" noValidate>
      <input type="hidden" name="token" value={token} />
      {/* Логин для менеджера паролей: браузер сохранит пару логин и пароль */}
      <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />
      <p className="rounded-lg bg-surface px-3.5 py-2.5 text-body text-ink">
        Ваш логин: <span className="font-semibold">{login}</span>
      </p>
      <Field
        label={reset ? "Новый пароль" : "Придумайте пароль"}
        id="password"
        name="password"
        type={show ? "text" : "password"}
        autoComplete="new-password"
        hint="Не короче 10 символов, не только цифры, без логина, имени и фамилии"
        required
      />
      <Field label="Повторите пароль" id="repeat" name="repeat" type={show ? "text" : "password"} autoComplete="new-password" required />
      <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 text-small text-ink">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} className="h-4 w-4 accent-blue-700" />
        Показать пароль
      </label>
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Сохраняем" : "Задать пароль и войти"}
      </Button>
    </form>
  );
}
