"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, KeyRound, CircleHelp, Eye, EyeOff, LayoutGrid, LogOut, ShieldCheck, Undo2, UserRound, UserRoundCog, Users } from "lucide-react";
import { exitManagement, logout } from "@/app/actions/auth";
import { endViewAsForLogoutAction, stopViewAsAction } from "@/app/actions/view-as";
import { markTabSelf, openViewAs } from "./view-as";
import { openOwnerAs, returnToOwnProfile } from "./owner-as";
import { cn } from "@/lib/cn";
import { ThemeSwitch } from "./theme-switch";
import { avatarTone } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/overlays";
import { forgetThisDevice } from "@/lib/offline/sign-out";
import { usePrototype } from "@/domain/store";

/**
 * Что делает «Сменить профиль» (этап 71): общий логин выбирает себя из списка, владелец при личном входе входит в
 * профиль другого человека, остальные при личном входе выходят и входят заново под другим логином. null: пункта нет
 * (идёт просмотр «Смотреть как» или владелец уже в чужом профиле, тогда в меню возврат)
 */
export type SwitchProfile = "team" | "owner" | "logout" | null;

type Props = {
  fullName: string;
  shortName: string;
  roleLabel: string;
  canManage: boolean;
  management: "OWNER" | "ADMIN" | null;
  managementUntil: string | null;
  /** «Сменить профиль» (этап 71): что делает пункт, null: пункта нет */
  switchProfile: SwitchProfile;
  /** Владелец в чужом профиле (этап 71): кто вошёл и чьи черновики отправить перед возвратом. Тогда в меню возврат */
  ownerAs?: { ownerName: string; targetSlug: string } | null;
  /** Вход владельца в чужой профиль закончился сам, владелец ещё не вернулся: в меню возврат */
  ownerAsEnded?: boolean;
  /** Владелец может открыть «Смотреть как…» (этап 63): личный вход, режим управления владельца */
  canViewAs?: boolean;
  /** Идёт просмотр «Смотреть как»: меню показывает выбранного человека и выход из просмотра */
  viewing?: boolean;
  /** Короткое имя владельца, который смотрит: при выходе из ресурса отправляются и стираются его черновики */
  ownerSlug?: string | null;
  tone?: "dark" | "light";
};

function initials(fullName: string) {
  const [last, first] = fullName.split(" ");
  return `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "?";
}

// Пункт меню по дизайн-системе (sv-menu__item): высота 36+, радиус поля, подсветка заливкой
// На телефоне пункты не ниже 44 px: пальцем по узкой строке легко промахнуться
const itemClass = "sv-menu__item cursor-pointer select-none outline-none data-[highlighted]:bg-field max-sm:min-h-11";

export function ProfileMenu({ fullName, shortName, roleLabel, canManage, management, managementUntil, switchProfile, ownerAs = null, ownerAsEnded = false, canViewAs = false, viewing = false, ownerSlug = null, tone = "dark" }: Props) {
  const [pending, startTransition] = useTransition();
  const { me, notify } = usePrototype();
  const dark = tone === "dark";
  /** Подтверждение «Выйти и сменить» у тех, кто вошёл лично и не владелец (этап 71) */
  const [confirmSwitch, setConfirmSwitch] = useState(false);
  const inside = !!ownerAs || ownerAsEnded;

  /**
   * Выход: «Выйти» и «Выйти и сменить». Сначала снимается просмотр «Смотреть как», если он был (сервер это знает сам), и
   * вкладка становится своей: сервер примет черновики самого владельца с устройства. Во входе владельца в чужой профиль
   * (этап 71) метка вкладки остаётся: черновики человека уходят от его имени с пометкой владельца. Отказал: черновики
   * остаются. Потом обычный выход на экран входа, после нового входа главная страница
   */
  const signOut = () =>
    startTransition(async () => {
      await endViewAsForLogoutAction();
      if (!inside) markTabSelf();
      await forgetThisDevice(viewing ? (ownerSlug ?? undefined) : me.slug);
      await logout();
    });

  const goBack = () =>
    startTransition(async () => {
      try {
        const error = await returnToOwnProfile(ownerAs?.targetSlug ?? null);
        if (error) notify(error, "error");
      } catch (e) {
        unstable_rethrow(e);
        notify("Нет связи с сервером. Попробуйте ещё раз", "error");
      }
    });

  return (
    <>
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "flex min-w-0 items-center gap-2.5 rounded-control text-left transition-colors",
          dark ? "w-full flex-1 p-1 text-sidebar-text hover:bg-sidebar-hover" : "h-10 px-1 text-ink hover:bg-field",
        )}
        aria-label={viewing ? `Профиль: ${fullName}, просмотр «Смотреть как»` : `Профиль: ${fullName}`}
      >
        <span className={cn("sv-avatar relative", `sv-avatar--${avatarTone(fullName)}`)} aria-hidden="true">
          {initials(fullName)}
          {/* На телефоне в шапке видна только аватарка: значок глаза говорит, что идёт просмотр (этап 63) */}
          {viewing ? (
            <span className={cn("absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-navy text-white ring-2 ring-surface", tone === "light" ? "sm:hidden" : "hidden")} data-testid="view-as-badge">
              <Eye className="h-2.5 w-2.5" strokeWidth={2.5} />
            </span>
          ) : null}
        </span>
        <span className={cn("min-w-0 flex-1", tone === "light" && "hidden sm:block")}>
          <span className="sv-sidebar__profile__name block">{shortName}</span>
          <span className={cn("block truncate text-caption", dark ? "text-sidebar-muted" : "text-text-secondary")}>{viewing ? "Просмотр, только чтение" : ownerAs ? "Вход владельца" : management ? "Режим управления" : roleLabel}</span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0", dark ? "text-sidebar-muted" : "text-text-secondary")} strokeWidth={1.5} aria-hidden="true" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-control-lg border border-line bg-surface p-1.5 shadow-medium"
        >
          <div className="px-3 pb-2 pt-1.5">
            <div className="text-body font-semibold text-ink">{fullName}</div>
            <div className="text-caption text-muted">{roleLabel}</div>
            {management && managementUntil ? (
              <div className="mt-1 text-caption text-blue-700">Режим управления до {managementUntil}</div>
            ) : null}
            {viewing ? <div className="mt-1 text-caption text-blue-700">Вы смотрите как этот человек, изменения недоступны</div> : null}
            {ownerAs ? <div className="mt-1 text-caption text-blue-700">Вы в этом профиле как владелец {ownerAs.ownerName}</div> : null}
          </div>
          {inside ? (
            <>
              <Menu.Separator className="my-1 h-px bg-line" />
              <Menu.Item className={itemClass} disabled={pending} onSelect={goBack}>
                <Undo2 className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                Вернуться в свой профиль
              </Menu.Item>
            </>
          ) : null}
          {viewing ? (
            <>
              <Menu.Separator className="my-1 h-px bg-line" />
              <Menu.Item className={itemClass} disabled={pending} onSelect={() => startTransition(() => stopViewAsAction())}>
                <EyeOff className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                Выйти из просмотра
              </Menu.Item>
            </>
          ) : null}
          <Menu.Separator className="my-1 h-px bg-line" />
          <div className="py-1.5" onKeyDown={(e) => e.stopPropagation()}>
            <ThemeSwitch />
          </div>
          <Menu.Separator className="my-1 h-px bg-line" />

          {/* Разделы «Управление» и «Инициативы» на телефоне за кнопкой «Ещё» нижнего меню (этап 41) */}
          <Menu.Item asChild>
            <Link href="/profile" className={itemClass}>
              <UserRound className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
              Профиль
            </Link>
          </Menu.Item>

          <Menu.Item asChild>
            <Link href="/help" className={itemClass}>
              <CircleHelp className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
              Как работать
            </Link>
          </Menu.Item>

          {/* Образец компонентов нужен разработке и управлению, команде в меню он только мешает */}
          {management ? (
            <Menu.Item asChild>
              <Link href="/ui" className={itemClass}>
                <LayoutGrid className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                Образец компонентов
              </Link>
            </Menu.Item>
          ) : null}

          {switchProfile === "team" ? (
            <Menu.Item asChild>
              <Link href="/choose" className={itemClass}>
                <Users className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                Сменить профиль
              </Link>
            </Menu.Item>
          ) : null}

          {/* Этап 71: владелец входит в профиль другого человека, остальные выходят и входят заново под другим логином */}
          {switchProfile === "owner" ? (
            <Menu.Item className={itemClass} onSelect={() => openOwnerAs()}>
              <UserRoundCog className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
              Сменить профиль
            </Menu.Item>
          ) : null}

          {switchProfile === "logout" ? (
            <Menu.Item className={itemClass} disabled={pending} onSelect={() => setConfirmSwitch(true)}>
              <Users className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
              Сменить профиль
            </Menu.Item>
          ) : null}

          {canViewAs ? (
            <Menu.Item className={itemClass} onSelect={() => openViewAs()}>
              <Eye className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
              Смотреть как…
            </Menu.Item>
          ) : null}

          {/* В просмотре режим управления выключен: включить его можно только после выхода из просмотра */}
          {canManage && !management && !viewing ? (
            <Menu.Item asChild>
              <Link href="/manage" className={itemClass}>
                <KeyRound className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                Включить режим управления
              </Link>
            </Menu.Item>
          ) : null}

          {management ? (
            <Menu.Item
              className={itemClass}
              disabled={pending}
              onSelect={() =>
                startTransition(async () => {
                  const r = await exitManagement();
                  if (r?.error) notify(r.error, "error");
                })
              }
            >
              <ShieldCheck className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
              Выключить режим управления
            </Menu.Item>
          ) : null}

          <Menu.Item className={itemClass} disabled={pending} onSelect={signOut}>
            <LogOut className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
            Выйти
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
    {switchProfile === "logout" ? (
      <Modal open={confirmSwitch} onOpenChange={(open) => !pending && setConfirmSwitch(open)} title="Точно хотите выйти из системы и сменить профиль?" description="Черновики с этого устройства уйдут на сервер, потом откроется экран входа. Войдите под другим логином и паролем, после входа откроется главная страница.">
        <div className="flex flex-wrap justify-end gap-2">
          {/* Фокус на безопасной кнопке: Enter по привычке не выходит из системы */}
          <Button variant="secondary" disabled={pending} onClick={() => setConfirmSwitch(false)} autoFocus>
            Отмена
          </Button>
          <Button variant="dark" loading={pending} disabled={pending} onClick={signOut}>
            Выйти и сменить
          </Button>
        </div>
      </Modal>
    ) : null}
    </>
  );
}
