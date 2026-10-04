"use client";

import { useActionState } from "react";
import { enterManagement, type FormState } from "@/app/actions/auth";
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
