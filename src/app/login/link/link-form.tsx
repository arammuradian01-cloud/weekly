"use client";

import { useActionState } from "react";
import { consumeLinkAction, type FormState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";

export function LinkLoginForm({ token, fullName }: { token: string; fullName: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(consumeLinkAction, null);
  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      <input type="hidden" name="token" value={token} />
      <FormError message={state?.error} />
      <Button type="submit" disabled={pending} className="w-full" aria-label={`Войти как ${fullName}`}>
        {pending ? "Входим" : "Войти"}
      </Button>
    </form>
  );
}
