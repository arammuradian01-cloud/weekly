"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { cancelEmailBindingAction, requestEmailBindingAction } from "@/app/(app)/profile/actions";
import { usePrototype } from "@/domain/store";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";

/**
 * Рабочая почта (этап 52): человек указывает адрес сам, адрес начинает работать после ссылки из письма. По
 * подтверждённой почте входят вместо логина и восстанавливают пароль, поэтому смена почты просит текущий пароль.
 * Ошибка показывается у формы, а не только всплывающим сообщением: так её видно и с экранным диктором
 */
export function EmailBinding({
  email,
  pending,
  mailOn,
  personal,
  domains,
  hasPassword,
  needsManagement = false,
  onDone,
}: {
  email: string | null;
  pending: string | null;
  mailOn: boolean;
  personal: boolean;
  domains: string[];
  /** Пароль задан: для смены почты нужен текущий */
  hasPassword: boolean;
  /** Владелец или администратор без режима управления: почту меняют только в нём */
  needsManagement?: boolean;
  /** Экран приветствия: после отправки письма ведёт дальше */
  onDone?: () => void;
}) {
  const router = useRouter();
  const { notify } = usePrototype();
  const [value, setValue] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const example = `name@${domains[0] ?? "sravni.ru"}`;

  if (!personal) return <p className="mt-2 text-body text-muted">Почту указывают при личном входе: по общему логину можно выбрать чужой профиль.</p>;

  const call = async (fn: () => Promise<{ ok: boolean; error?: string }>, ok: string): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) {
        setError(r.error ?? "Не получилось");
        return false;
      }
      notify(ok);
      router.refresh();
      return true;
    } catch {
      setError("Нет связи с сервером: попробуйте ещё раз");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex max-w-md flex-col gap-3" data-testid="email-binding">
      {email ? (
        <p className="text-body text-ink">
          Подтверждённая почта: <span className="font-semibold break-all">{email}</span>. По ней можно входить вместо логина и восстанавливать пароль.
        </p>
      ) : null}
      {pending ? (
        <div className="sv-alert sv-alert--info" data-testid="email-pending">
          <p>
            Ждёт подтверждения: <span className="font-semibold break-all">{pending}</span>. Откройте письмо и нажмите ссылку, она действует сутки.
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={busy}
            aria-label={`Отменить подтверждение адреса ${pending}`}
            onClick={() => void call(() => cancelEmailBindingAction(), "Адрес снят с подтверждения")}
          >
            Отменить
          </Button>
        </div>
      ) : null}
      {needsManagement ? (
        <p className="text-small text-muted">Владельцы и администраторы меняют почту в режиме управления: по этой почте подтверждается режим.</p>
      ) : mailOn ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy || !value.trim()) return;
            const ok = await call(() => requestEmailBindingAction(value, password), "Письмо со ссылкой отправлено");
            if (ok) {
              setValue("");
              setPassword("");
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
          {hasPassword ? (
            <Field
              label="Ваш пароль"
              id="work-email-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              hint="По почте восстанавливают пароль, поэтому её меняют только с паролем"
            />
          ) : null}
          <FormError message={error ?? undefined} />
          <div>
            <Button type="submit" size="sm" variant="secondary" disabled={busy || !value.trim() || (hasPassword && !password)}>
              {busy ? "Отправляем" : "Прислать ссылку"}
            </Button>
          </div>
        </form>
      ) : (
        <p className="text-small text-muted">Почта ресурса ещё не настроена, поэтому подтвердить адрес нечем. Пока адрес может вписать владелец ресурса в списке людей.</p>
      )}
      {!mailOn || needsManagement ? <FormError message={error ?? undefined} /> : null}
    </div>
  );
}
