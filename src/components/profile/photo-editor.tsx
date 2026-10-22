"use client";

// Фото профиля (этап 80): выбрать файл, посмотреть, как оно встанет в квадрат, сохранить или убрать. Файл уходит телом
// запроса в обработчик /api/profile/photo, там он проверяется по содержимому и становится квадратом WebP без EXIF.
// person: чьё фото меняет владелец в режиме управления; без него своё

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ImageUp } from "lucide-react";
import { usePrototype } from "@/domain/store";
import type { AvatarPhoto } from "@/domain/people";
import { removePhotoAction } from "@/app/(app)/profile/actions";
import { Avatar } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { FormError } from "@/components/ui/field";
import { AVATAR_ACCEPT, AVATAR_MAX_LABEL, pickedFileRefusal, readPhotoAnswer, type PhotoAnswer } from "@/lib/profile/rules";

/** Инициалы «ИФ» из «Фамилия Имя», как у аватаров в списках людей */
function initialsOf(fullName: string): string {
  const [last, first] = fullName.split(/\s+/);
  return first ? `${first.charAt(0)}${last!.charAt(0)}` : fullName.slice(0, 2);
}

async function sendPhoto(file: File, person: string | null): Promise<PhotoAnswer> {
  try {
    const res = await fetch(`/api/profile/photo${person ? `?person=${encodeURIComponent(person)}` : ""}`, {
      method: "POST",
      body: file,
      headers: { "Content-Type": "application/octet-stream" },
    });
    return await readPhotoAnswer(res);
  } catch {
    return { ok: false, error: "Нет связи с сервером: фото не отправилось" };
  }
}

export function PhotoEditor({
  person = null,
  fullName,
  photo,
  locked = null,
  onChanged,
  idPrefix = "photo",
}: {
  person?: string | null;
  fullName: string;
  photo: AvatarPhoto | null;
  /** Почему менять нельзя (общий логин, просмотр): тогда только фото и причина */
  locked?: string | null;
  /** Фото сохранено или убрано: карточка перечитывает данные */
  onChanged?: () => void;
  idPrefix?: string;
}) {
  const router = useRouter();
  const { notify } = usePrototype();
  const input = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{ file: File; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Адрес предпросмотра живёт, пока выбран этот файл: старый освобождается при смене файла и уходе со страницы
  const shownUrl = useRef<string | null>(null);
  useEffect(() => () => {
    if (shownUrl.current) URL.revokeObjectURL(shownUrl.current);
  }, []);

  const pick = (file: File | null) => {
    if (shownUrl.current) URL.revokeObjectURL(shownUrl.current);
    shownUrl.current = null;
    setPicked(null);
    setError(undefined);
    if (!file) return;
    const refusal = pickedFileRefusal(file);
    if (refusal) {
      setError(refusal);
      return;
    }
    const url = URL.createObjectURL(file);
    shownUrl.current = url;
    setPicked({ file, url });
  };

  const save = async () => {
    if (!picked || busy) return;
    setBusy(true);
    setError(undefined);
    const r = await sendPhoto(picked.file, person);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    pick(null);
    notify("Фото сохранено");
    onChanged?.();
    router.refresh();
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await removePhotoAction(person);
      if (!r.ok) setError(r.error);
      else {
        notify("Фото убрано");
        onChanged?.();
        router.refresh();
      }
    } catch {
      setError("Нет связи с сервером: фото не убрано");
    }
    setBusy(false);
  };

  const fileId = `${idPrefix}-file`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        {picked ? (
          <span className="sv-avatar sv-avatar--2xl" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element -- предпросмотр выбранного файла с устройства */}
            <img src={picked.url} alt="" className="sv-avatar__img" data-testid="photo-preview" />
          </span>
        ) : (
          <Avatar text={initialsOf(fullName)} name={fullName} size="2xl" photo={photo} />
        )}
        {locked ? null : (
          <div className="flex flex-wrap items-center gap-2">
            {/* Само поле скрыто, но доступно с клавиатуры через кнопку; подпись для диктора у поля своя */}
            <input
              ref={input}
              id={fileId}
              type="file"
              accept={AVATAR_ACCEPT}
              className="sr-only"
              tabIndex={-1}
              aria-label="Файл фото"
              data-testid="photo-input"
              onChange={(e) => {
                pick(e.target.files?.[0] ?? null);
                e.target.value = "";
              }}
            />
            {picked ? (
              <>
                <Button size="sm" onClick={save} loading={busy} disabled={busy} data-testid="photo-save">
                  Сохранить фото
                </Button>
                <Button size="sm" variant="ghost" onClick={() => pick(null)} disabled={busy}>
                  Отмена
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => input.current?.click()} disabled={busy} data-testid="photo-pick">
                  <ImageUp className="h-4 w-4" aria-hidden="true" />
                  {photo ? "Заменить фото" : "Выбрать фото"}
                </Button>
                {photo ? (
                  <Button size="sm" variant="ghost" onClick={remove} disabled={busy} data-testid="photo-remove">
                    Убрать фото
                  </Button>
                ) : null}
              </>
            )}
          </div>
        )}
      </div>
      {locked ? (
        <p className="text-small text-muted">{locked}</p>
      ) : (
        <p className="text-small text-muted">
          {picked
            ? "Так фото встанет в квадрат. Если нравится, сохраните."
            : `JPEG, PNG или WebP до ${AVATAR_MAX_LABEL}. Фото обрежем до квадрата по центру, сведения о камере и месте съёмки удалим. Фото видят все коллеги.`}
        </p>
      )}
      <FormError message={error} />
    </div>
  );
}
