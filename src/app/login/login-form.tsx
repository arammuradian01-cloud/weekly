"use client";

import { useActionState } from "react";
import { login, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

export function LoginForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(login, null);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field label="Логин" id="login" name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} required />
      <Field label="Пароль" id="password" name="password" type="password" autoComplete="current-password" required />
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="mt-1 w-full">
        {pending ? "Проверяем" : "Войти"}
      </Button>
    </form>
  );
}
