// Фото профиля (этап 80): из загруженного файла две готовые картинки WebP, квадрат по центру 256×256 и 64×64.
// Библиотека sharp (libvips) уже стоит вместе с Next, внешних сервисов нет. Поворот по EXIF применяется к точкам,
// затем все метаданные (EXIF с геопозицией, моделью камеры и временем съёмки, XMP, цветовой профиль) не переносятся:
// sharp без withMetadata их не пишет. Прозрачность заливается белым: под фото лежат инициалы, они не должны проступать.

import sharp, { type Metadata } from "sharp";
import { AVATAR_LARGE, AVATAR_MAX_PIXELS, AVATAR_SMALL, AvatarError, PROFILE_TEXTS, imageKindRefusal, imageSizeRefusal, sniffImage } from "./rules";

export type AvatarImages = { large: Uint8Array<ArrayBuffer>; small: Uint8Array<ArrayBuffer> };

// Сервер маленький (1 ядро, 1 ГБ): кэш libvips не держим, картинки обрабатываются по одной
sharp.cache(false);
let queue: Promise<unknown> = Promise.resolve();

/** По одной обработке за раз: две большие картинки одновременно могли бы не поместиться в память */
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}

/** Самая короткая сторона исходника, меньше которой фото не берём */
const MIN_SIDE = 32;

/**
 * Готовые картинки из файла. Тип проверяется по содержимому дважды: по первым байтам и тем, что прочитала libvips
 * (файл с подписью JPEG внутри может оказаться чем угодно). Ошибка с понятным текстом: AvatarError
 */
export async function makeAvatar(input: Uint8Array): Promise<AvatarImages> {
  const size = imageSizeRefusal(input.byteLength);
  if (size) throw new AvatarError(size);
  const kind = sniffImage(input);
  const refusal = imageKindRefusal(kind);
  if (refusal) throw new AvatarError(refusal);
  return oneAtATime(async () => {
    const source = () => sharp(input, { limitInputPixels: AVATAR_MAX_PIXELS, failOn: "error", animated: false });
    let meta: Metadata;
    try {
      meta = await source().metadata();
    } catch (error) {
      throw new AvatarError(pixelLimit(error) ? PROFILE_TEXTS.hugePixels : PROFILE_TEXTS.broken);
    }
    if (meta.format !== kind) throw new AvatarError(PROFILE_TEXTS.broken);
    if (!meta.width || !meta.height) throw new AvatarError(PROFILE_TEXTS.broken);
    if (meta.width * meta.height > AVATAR_MAX_PIXELS) throw new AvatarError(PROFILE_TEXTS.hugePixels);
    if (Math.min(meta.width, meta.height) < MIN_SIDE) throw new AvatarError(PROFILE_TEXTS.tooSmall);
    try {
      const large = await source()
        .rotate()
        .resize(AVATAR_LARGE, AVATAR_LARGE, { fit: "cover", position: "centre" })
        .flatten({ background: "#ffffff" })
        .webp({ quality: 82, effort: 4 })
        .toBuffer();
      // Мелкая из крупной: та же обрезка, и исходник второй раз не разбирается
      const small = await sharp(large).resize(AVATAR_SMALL, AVATAR_SMALL).webp({ quality: 80, effort: 4 }).toBuffer();
      return { large: new Uint8Array(large), small: new Uint8Array(small) };
    } catch (error) {
      throw new AvatarError(pixelLimit(error) ? PROFILE_TEXTS.hugePixels : PROFILE_TEXTS.broken);
    }
  });
}

const pixelLimit = (error: unknown) => error instanceof Error && /pixel limit/i.test(error.message);
