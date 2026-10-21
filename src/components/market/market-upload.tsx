"use client";

// Загрузка пакета рынка (этап 62): владелец при личном входе выбирает один файл JSON с кодом страницы и данными.
// Файл уходит телом запроса в обработчик загрузки, пакет целиком заменяет прежний. Ошибки проверки приходят текстом

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { MARKET_MAX_BYTES } from "@/lib/market/bundle";
import { plural } from "@/domain/dates";

type Answer = { ok: true; value: { datasetsCount: number; rowsTotal: number } } | { ok: false; error: string };

async function postBundle(file: File): Promise<Answer> {
  let res: Response;
  try {
    res = await fetch("/api/market/upload", { method: "POST", body: file, headers: { "Content-Type": "application/json" } });
  } catch {
    return { ok: false, error: "Нет связи с сервером: пакет не отправился" };
  }
  if (res.redirected || !(res.headers.get("content-type") ?? "").includes("application/json")) return { ok: false, error: "Вход закончился: обновите страницу, войдите и загрузите пакет снова" };
  return (await res.json().catch(() => null)) ?? { ok: false, error: "Не получилось прочитать ответ сервера. Обновите страницу и попробуйте ещё раз" };
}

export function MarketUpload() {
  const router = useRouter();
  const { notify } = usePrototype();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const send = async (file: File) => {
    if (file.size > MARKET_MAX_BYTES) {
      setError("Файл больше 25 МБ: пакет рынка может быть не больше 25 МБ");
      return;
    }
    setBusy(true);
    setError(undefined);
    const r = await postBundle(file);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    const { datasetsCount: n, rowsTotal: rows } = r.value;
    notify(`Пакет рынка загружен: ${n} ${plural(n, "набор", "набора", "наборов")} данных, ${rows} ${plural(rows, "строка", "строки", "строк")}`);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        tabIndex={-1}
        aria-label="Файл пакета рынка"
        data-testid="market-upload-input"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void send(file);
        }}
      />
      <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy} data-testid="market-upload">
        <Upload className="h-4 w-4" aria-hidden="true" />
        {busy ? "Загружаем пакет" : "Загрузить пакет рынка"}
      </Button>
      <FormError message={error} />
    </div>
  );
}
