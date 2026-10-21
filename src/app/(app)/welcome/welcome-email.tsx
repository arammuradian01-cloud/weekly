"use client";

import { useState } from "react";
import { EmailBinding } from "@/components/profile/email-binding";

/** Почта на экране приветствия: после отправки письма одна подсказка, что делать дальше (её и объявляет диктор) */
export function WelcomeEmail(props: { email: string | null; pending: string | null; mailOn: boolean; personal: boolean; domains: string[]; hasPassword: boolean; needsManagement: boolean }) {
  const [sent, setSent] = useState(false);
  return (
    <>
      <EmailBinding {...props} onDone={() => setSent(true)} />
      {sent ? <p className="mt-3 text-small text-green-ink">Откройте письмо, когда будет удобно: ссылка действует сутки. Пока можно работать.</p> : null}
    </>
  );
}
