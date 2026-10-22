"use client";

import Link from "next/link";
import { useTransition } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, KeyRound, CircleHelp, Eye, EyeOff, LayoutGrid, LogOut, ShieldCheck, UserRound, Users } from "lucide-react";
import { exitManagement, logout } from "@/app/actions/auth";
import { endViewAsForLogoutAction, stopViewAsAction } from "@/app/actions/view-as";
import { markTabSelf, openViewAs } from "./view-as";
import { cn } from "@/lib/cn";
import { ThemeSwitch } from "./theme-switch";
import { avatarTone } from "@/components/ui/primitives";
import { forgetThisDevice } from "@/lib/offline/sign-out";
import { usePrototype } from "@/domain/store";

type Props = {
  fullName: string;
  shortName: string;
  roleLabel: string;
  canManage: boolean;
  management: "OWNER" | "ADMIN" | null;
  managementUntil: string | null;
  /** Личный вход: профиль не выбирается из списка, «Сменить профиль» не нужен */
  personal: boolean;
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
const itemClass = "sv-menu__item cursor-pointer select-none outline-none data-[highlighted]:bg-field";

export function ProfileMenu({ fullName, shortName, roleLabel, canManage, management, managementUntil, personal, canViewAs = false, viewing = false, ownerSlug = null, tone = "dark" }: Props) {
  const [pending, startTransition] = useTransition();
  const { me, notify } = usePrototype();
  const dark = tone === "dark";

  return (
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
          <span className={cn("block truncate text-caption", dark ? "text-sidebar-muted" : "text-text-secondary")}>{viewing ? "Просмотр, только чтение" : management ? "Режим управления" : roleLabel}</span>
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
          </div>
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

          {/* Разделы «Управление», «Один на один» и «Инициативы» на телефоне за кнопкой «Ещё» нижнего меню (этап 41) */}
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

          {personal ? null : (
            <Menu.Item asChild>
              <Link href="/choose" className={itemClass}>
                <Users className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                Сменить профиль
              </Link>
            </Menu.Item>
          )}

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

          <Menu.Item
            className={itemClass}
            disabled={pending}
            onSelect={() =>
              startTransition(async () => {
                // «Смотреть как» (этап 63): сначала снимается просмотр, если он был (сервер это знает сам), и вкладка
                // становится своей: сервер примет черновики самого владельца с устройства. Отказал: черновики остаются
                await endViewAsForLogoutAction();
                markTabSelf();
                await forgetThisDevice(viewing ? (ownerSlug ?? undefined) : me.slug);
                await logout();
              })
            }
          >
            <LogOut className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
            Выйти
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
