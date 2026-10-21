"use client";

import Link from "next/link";
import { useActionState } from "react";
import { confirmEmailAction, type ConfirmState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

export function ConfirmEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState<ConfirmState, FormData>(confirmEmailAction, null);
  if (state?.email) {
    return (
      <div className="mt-3 flex flex-col gap-3" data-testid="email-confirmed">
        <p className="sv-alert sv-alert--success" role="status">
          Почта {state.email} подтверждена. Теперь по ней можно входить вместо логина и восстанавливать пароль.
        </p>
        <Link href="/" className="text-body font-medium text-blue-700 underline-offset-2 hover:underline">
          Перейти в Weekly
        </Link>
      </div>
    );
  }
  return (
    <form action={action} className="mt-3 flex flex-col gap-4">
      <p className="text-body text-muted">Нажмите кнопку, чтобы привязать этот адрес к своему входу в Weekly.</p>
      <input type="hidden" name="token" value={token} />
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending || !token} className="w-full">
        {pending ? "Подтверждаем" : "Подтвердить почту"}
      </Button>
    </form>
  );
}
