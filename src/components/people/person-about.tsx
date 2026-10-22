"use client";

// «О себе» в карточке человека (этап 80): тексты, которые человек написал в профиле, и ссылка на Telegram. Загружаются
// при открытии карточки, а не вместе с деревом людей: у сотен людей тексты заметно утяжелили бы каждую страницу «Людей».
// Тексты выводятся как текст, переносы строк сохраняются. Владелец в режиме управления может поправить фото и тексты
// (например, убрать неподходящее фото), правка идёт в журнал

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePrototype } from "@/domain/store";
import { personProfileAction } from "@/app/(app)/profile/actions";
import type { PersonProfile } from "@/lib/profile/service";
import { telegramUrl } from "@/lib/profile/rules";
import { Collapsible } from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/primitives";
import { PhotoEditor } from "@/components/profile/photo-editor";
import { AboutForm } from "@/components/profile/about-form";
import { cn } from "@/lib/cn";

export type ProfileState = { profile: PersonProfile | null | undefined; failed: boolean; reload: () => void };

/** Фото и «О себе» человека для карточки. profile undefined: ещё грузится; null: человека нет или не загрузилось */
export function usePersonProfile(slug: string): ProfileState {
  const [tick, setTick] = useState(0);
  const [state, setState] = useState<{ slug: string; tick: number; profile: PersonProfile | null; failed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    personProfileAction(slug)
      .then((r) => live && setState({ slug, tick, profile: r.ok ? r.value : null, failed: !r.ok }))
      .catch(() => live && setState({ slug, tick, profile: null, failed: true }));
    return () => {
      live = false;
    };
  }, [slug, tick]);
  // Пока карточка того же человека перечитывается после правки, видны прежние данные, а не пустое место
  const own = state?.slug === slug ? state : null;
  return { profile: own ? own.profile : undefined, failed: own?.failed ?? false, reload: () => setTick((n) => n + 1) };
}

export function PersonAbout({ state, slug, fullName, mine, compact }: { state: ProfileState; slug: string; fullName: string; mine: boolean; compact: boolean }) {
  const { manageRole, viewing } = usePrototype();
  const { profile, failed, reload } = state;
  if (profile === undefined) {
    return (
      <div className={cn("flex flex-col gap-2", compact ? "mt-4" : "mt-3")} aria-hidden="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
    );
  }
  if (!profile) return failed ? <p className="mt-3 text-small text-muted">Не получилось загрузить «О себе». Откройте карточку ещё раз.</p> : null;
  const empty = !profile.about && !profile.helpWith && !profile.telegram;
  // Владелец в режиме управления правит чужие фото и тексты; свои он правит в профиле, как все
  const moderate = manageRole === "OWNER" && !viewing && !mine;
  return (
    <div className={cn("flex flex-col gap-3", compact ? "mt-4" : "mt-3")} data-testid="person-about">
      {empty ? (
        mine ? (
          <p className="text-body text-text-secondary">
            Вы ещё ничего не рассказали о себе.{" "}
            <Link href="/profile" className="font-semibold text-link hover:underline">
              Добавить фото и «О себе»
            </Link>
          </p>
        ) : (
          <p className="text-body text-text-secondary">О себе пока не заполнено</p>
        )
      ) : (
        <dl className="flex flex-col gap-3 text-body">
          {profile.about ? (
            <div>
              <dt className="text-caption text-text-secondary">О себе</dt>
              <dd className="whitespace-pre-line text-ink [overflow-wrap:anywhere]">{profile.about}</dd>
            </div>
          ) : null}
          {profile.helpWith ? (
            <div>
              <dt className="text-caption text-text-secondary">Чем могу помочь коллегам</dt>
              <dd className="whitespace-pre-line text-ink [overflow-wrap:anywhere]">{profile.helpWith}</dd>
            </div>
          ) : null}
          {profile.telegram ? (
            <div>
              <dt className="text-caption text-text-secondary">Telegram</dt>
              <dd>
                <a href={telegramUrl(profile.telegram)} target="_blank" rel="noopener noreferrer" className="font-semibold text-link hover:underline [overflow-wrap:anywhere]">
                  @{profile.telegram}
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      )}
      {moderate ? (
        <Collapsible id={`owner-edit-${slug}`} title="Изменить фото и «О себе»" hint="Владелец в режиме управления, правка попадёт в журнал" headingLevel={3} testId="owner-edit">
          <div className="flex flex-col gap-5">
            <PhotoEditor person={slug} fullName={fullName} photo={profile.avatar ? { slug, version: profile.avatar } : null} onChanged={reload} idPrefix={`owner-photo-${slug}`} />
            <AboutForm key={slug} person={slug} initial={profile} onSaved={reload} idPrefix={`owner-about-${slug}`} />
          </div>
        </Collapsible>
      ) : null}
    </div>
  );
}
