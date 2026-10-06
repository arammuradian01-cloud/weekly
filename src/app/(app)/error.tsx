"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";

/**
 * Сбой на странице внутри ресурса. Меню остаётся на месте, черновики weekly уже сохранены на сервере.
 * Код ошибки нужен, чтобы найти её в логах сервера
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Сбой страницы", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-[560px] py-10">
      <h1 className="text-[26px] font-semibold leading-tight text-ink">Страница не открылась</h1>
      <p className="mt-2 text-[15px] text-muted">
        На сервере что-то пошло не так. То, что вы уже сохранили, не пропало: черновик weekly и правки задач сохраняются сразу. Попробуйте открыть страницу ещё раз.
      </p>
      {error.digest ? <p className="mt-2 text-[13px] text-muted">Код ошибки для разбора: {error.digest}</p> : null}
      <div className="mt-6 flex flex-col gap-2 sm:flex-row">
        <Button onClick={reset}>
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
          Открыть ещё раз
        </Button>
        <Link href="/" className={buttonClass("secondary")}>
          На мою неделю
        </Link>
      </div>
    </div>
  );
}
