"use client";

// Загрузка пакета рынка (этап 62): владелец при личном входе выбирает один файл с кодом страницы и данными.
// Файл уходит телом запроса в обработчик загрузки, пакет целиком заменяет прежний. Ошибки проверки приходят текстом.
// Этап 83: принимается и сжатый файл .json.gz. Обычный .json браузер сжимает сам перед отправкой, если умеет
// (CompressionStream), и отправляет с заголовком Content-Encoding: gzip: пакет около 16 МБ так превращается
// примерно в 1,6 МБ и проходит через предел на размер запроса у прокси хостинга. Если браузер сжимать не умеет,
// файл уходит как раньше

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { usePrototype } from "@/domain/store";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { MARKET_MAX_BYTES } from "@/lib/market/bundle";
import { MARKET_ANSWER_TEXTS, readMarketAnswer, type MarketAnswer } from "@/lib/market/answers";
import { plural } from "@/domain/dates";

type Uploaded = { value: { datasetsCount: number; rowsTotal: number } };

/** Файл уже сжат: по имени или по типу */
const isPacked = (file: File) => /\.gz$/i.test(file.name) || file.type === "application/gzip" || file.type === "application/x-gzip";

/** Сжатие файла в браузере: null, если браузер не умеет или сжать не получилось */
async function packInBrowser(file: File): Promise<Blob | null> {
  if (typeof CompressionStream === "undefined") return null;
  try {
    const packed = file.stream().pipeThrough(new CompressionStream("gzip"));
    return await new Response(packed).blob();
  } catch {
    return null;
  }
}

async function postBundle(file: File): Promise<MarketAnswer<Uploaded>> {
  // Сжатый файл уходит как есть, обычный браузер сжимает сам: так запрос проходит через предел размера у прокси
  const packed = isPacked(file) ? file : await packInBrowser(file);
  const body: BodyInit = packed ?? file;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (packed) headers["Content-Encoding"] = "gzip";
  let res: Response;
  try {
    res = await fetch("/api/market/upload", { method: "POST", body, headers });
  } catch {
    return { ok: false, error: "Нет связи с сервером: пакет не отправился. Если файл большой, попробуйте сжатый файл .json.gz" };
  }
  // Статус разбирается: 401 вход закончился, 413 файл слишком большой, ошибка проверки текстом сервера, иначе общий текст
  return readMarketAnswer<Uploaded>(res, "upload");
}

export function MarketUpload() {
  const router = useRouter();
  const { notify } = usePrototype();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  const send = async (file: File) => {
    // Предел на сам выбранный файл: и для обычного, и для сжатого
    if (file.size > MARKET_MAX_BYTES) {
      setError(isPacked(file) ? MARKET_ANSWER_TEXTS.upload.tooBigPacked : MARKET_ANSWER_TEXTS.upload.tooBig);
      return;
    }
    if (!/\.(json|json\.gz|gz)$/i.test(file.name)) {
      setError(MARKET_ANSWER_TEXTS.upload.wrongFile);
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
    const { datasetsCount: n, rowsTotal: rows } = r.value.value;
    notify(`Пакет рынка загружен: ${n} ${plural(n, "набор", "набора", "наборов")} данных, ${rows} ${plural(rows, "строка", "строки", "строк")}`);
    router.refresh();
  };

  return (
    <div className="flex flex-col items-start gap-2 sm:items-end">
      <input
        ref={input}
        type="file"
        accept=".json,.gz,.json.gz,application/json,application/gzip"
        className="sr-only"
        tabIndex={-1}
        aria-label="Файл пакета рынка: .json или сжатый .json.gz"
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
      <p className="text-xs text-muted-foreground sm:text-right" data-testid="market-upload-hint">
        Подойдёт файл .json и сжатый .json.gz. Сжатый загружается быстрее и надёжнее проходит
      </p>
      <FormError message={error} />
    </div>
  );
}
