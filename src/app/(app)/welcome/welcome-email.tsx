"use client";

import { useState } from "react";
import { EmailBinding } from "@/components/profile/email-binding";

/** Почта на экране приветствия: после отправки письма подсказка, что делать дальше */
export function WelcomeEmail(props: { email: string | null; pending: string | null; mailOn: boolean; personal: boolean; domains: string[] }) {
  const [sent, setSent] = useState(false);
  return (
    <>
      <EmailBinding {...props} onDone={() => setSent(true)} />
      {sent ? (
        <p role="status" className="mt-3 text-small text-green-ink">
          Письмо отправлено. Откройте его, когда будет удобно: ссылка действует сутки. Пока можно работать.
        </p>
      ) : null}
    </>
  );
}
