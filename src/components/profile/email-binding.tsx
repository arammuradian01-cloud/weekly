"use client";

import { useState } from "react";
import { cancelEmailBindingAction, requestEmailBindingAction } from "@/app/(app)/profile/actions";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";

/**
 * Рабочая почта (этап 52): человек указывает адрес сам, адрес начинает работать после ссылки из письма. По
 * подтверждённой почте входят вместо логина и восстанавливают пароль
 */
export function EmailBinding({
  email,
  pending,
  mailOn,
  personal,
  domains,
  onDone,
}: {
  email: string | null;
  pending: string | null;
  mailOn: boolean;
  personal: boolean;
  domains: string[];
  /** Экран приветствия: после отправки письма ведёт дальше */
  onDone?: () => void;
}) {
  const run = useRunAction();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const example = `name@${domains[0] ?? "sravni.ru"}`;

  if (!personal) return <p className="mt-2 text-body text-muted">Почту указывают при личном входе: по общему логину можно выбрать чужой профиль.</p>;

  return (
    <div className="mt-3 flex max-w-md flex-col gap-3" data-testid="email-binding">
      {email ? (
        <p className="text-body text-ink">
          Подтверждённая почта: <span className="font-semibold">{email}</span>. По ней можно входить вместо логина и восстанавливать пароль.
        </p>
      ) : null}
      {pending ? (
        <div className="sv-alert sv-alert--info" role="status" data-testid="email-pending">
          <p>
            Ждёт подтверждения: <span className="font-semibold">{pending}</span>. Откройте письмо и нажмите ссылку, она действует сутки.
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await run(() => cancelEmailBindingAction(), "Адрес снят с подтверждения");
              setBusy(false);
            }}
          >
            Отменить
          </Button>
        </div>
      ) : null}
      {mailOn ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !value.trim()) return;
            setBusy(true);
            const r = await run(() => requestEmailBindingAction(value), "Письмо со ссылкой отправлено");
            setBusy(false);
            if (r) {
              setValue("");
              onDone?.();
            }
          }}
        >
          <Field
            label={email ? "Другая рабочая почта" : "Рабочая почта"}
            id="work-email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            hint={`Адрес вида ${example}. На него придёт ссылка подтверждения`}
          />
          <div>
            <Button type="submit" size="sm" variant="secondary" disabled={busy || !value.trim()}>
              {busy ? "Отправляем" : "Прислать ссылку"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-small text-muted">Почта ресурса ещё не настроена, поэтому подтвердить адрес нечем. Пока адрес может вписать владелец ресурса в списке людей.</p>
      )}
    </div>
  );
}
