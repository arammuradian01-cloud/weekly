"use client";

import { useActionState } from "react";
import { confirmStepUpAction, enterManagement, requestStepUpAction, type EmailFormState, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

export function ManageForm({ passwordLabel, next }: { passwordLabel: string; next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(enterManagement, null);
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="next" value={next} />
      <Field label={passwordLabel} id="password" name="password" type="password" autoComplete="current-password" required autoFocus />
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Проверяем" : "Включить на 12 часов"}
      </Button>
    </form>
  );
}

/** Режим управления по ссылке на почту: для личного входа вместо пароля управления */
export function StepUpForm() {
  const [state, action, pending] = useActionState<EmailFormState>(requestStepUpAction, null);
  if (state?.sent) {
    return (
      <p role="status" className="rounded-lg bg-green-soft px-3.5 py-3 text-[14px] text-green-ink">
        Письмо отправлено. Ссылка действует 15 минут.
      </p>
    );
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <FormError message={state?.error} />
      <Button type="submit" variant="secondary" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Отправляем" : "Прислать ссылку на почту"}
      </Button>
    </form>
  );
}

/** Экран ссылки подтверждения из письма */
export function ConfirmStepUpForm({ token, next }: { token: string; next: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(confirmStepUpAction, null);
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="next" value={next} />
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Проверяем" : "Включить на 12 часов"}
      </Button>
    </form>
  );
}
