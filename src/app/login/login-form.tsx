"use client";

import { useActionState } from "react";
import { login, requestEmailLinkAction, type EmailFormState, type FormState } from "@/app/actions/auth";
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

/** Запрос личной ссылки на рабочую почту */
export function EmailLinkForm({ primary = false }: { primary?: boolean }) {
  const [state, action, pending] = useActionState<EmailFormState, FormData>(requestEmailLinkAction, null);
  if (state?.sent) {
    return (
      <p role="status" className="rounded-lg bg-green-soft px-3.5 py-3 text-[14px] text-green-ink">
        Если адрес есть в списке команды, письмо со ссылкой придёт в течение минуты. Ссылка действует 15 минут. Нет письма: проверьте «Спам» или попросите ссылку у владельца.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field label="Рабочая почта" id="email" name="email" type="email" autoComplete="email" autoCapitalize="none" spellCheck={false} required />
      <FormError message={state?.error} />
      <Button type="submit" variant={primary ? "primary" : "secondary"} disabled={pending} className="w-full">
        {pending ? "Отправляем" : "Прислать ссылку для входа"}
      </Button>
    </form>
  );
}
