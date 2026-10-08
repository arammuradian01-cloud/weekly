"use client";

import Link from "next/link";
import { useTransition } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, KeyRound, CircleHelp, LayoutGrid, LogOut, MessagesSquare, ShieldCheck, UserRound, Users } from "lucide-react";
import { exitManagement, logout } from "@/app/actions/auth";
import { MANAGEMENT_NAV } from "./nav";
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
  tone?: "dark" | "light";
};

function initials(fullName: string) {
  const [last, first] = fullName.split(" ");
  return `${(first ?? "").charAt(0)}${(last ?? "").charAt(0)}`.toUpperCase() || "?";
}

// Пункт меню по дизайн-системе (sv-menu__item): высота 36+, радиус поля, подсветка заливкой
const itemClass = "sv-menu__item cursor-pointer select-none outline-none data-[highlighted]:bg-field";

export function ProfileMenu({ fullName, shortName, roleLabel, canManage, management, managementUntil, personal, tone = "dark" }: Props) {
  const [pending, startTransition] = useTransition();
  const { me } = usePrototype();
  const dark = tone === "dark";

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "flex min-w-0 items-center gap-2.5 rounded-control text-left transition-colors",
          dark ? "w-full flex-1 p-1 text-sidebar-text hover:bg-sidebar-hover" : "h-10 px-1 text-ink hover:bg-field",
        )}
        aria-label={`Профиль: ${fullName}`}
      >
        <span className={cn("sv-avatar", `sv-avatar--${avatarTone(fullName)}`)} aria-hidden="true">
          {initials(fullName)}
        </span>
        <span className={cn("min-w-0 flex-1", tone === "light" && "hidden sm:block")}>
          <span className="sv-sidebar__profile__name block">{shortName}</span>
          <span className={cn("block truncate text-caption", dark ? "text-sidebar-muted" : "text-text-secondary")}>{management ? "Режим управления" : roleLabel}</span>
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
          </div>
          <Menu.Separator className="my-1 h-px bg-line" />
          <div className="py-1.5" onKeyDown={(e) => e.stopPropagation()}>
            <ThemeSwitch />
          </div>
          <Menu.Separator className="my-1 h-px bg-line" />

          {management ? (
            <div className="lg:hidden">
              {MANAGEMENT_NAV.filter((i) => !i.ownerOnly || management === "OWNER").map((item) => (
                <Menu.Item key={item.href} asChild>
                  <Link href={item.href} className={itemClass}>
                    <item.icon className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                    {item.label}
                  </Link>
                </Menu.Item>
              ))}
              <Menu.Separator className="my-1 h-px bg-line" />
            </div>
          ) : null}

          {personal ? (
            // Встречи один на один (этап 28): на телефоне в нижнем меню места нет, открываются отсюда
            <Menu.Item asChild>
              <Link href="/one-on-one" className={cn(itemClass, "lg:hidden")}>
                <MessagesSquare className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                Один на один
              </Link>
            </Menu.Item>
          ) : null}

          <Menu.Item asChild>
            <Link href="/profile" className={itemClass}>
              <UserRound className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
              Профиль и входы
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

          {canManage && !management ? (
            <Menu.Item asChild>
              <Link href="/manage" className={itemClass}>
                <KeyRound className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
                Включить режим управления
              </Link>
            </Menu.Item>
          ) : null}

          {management ? (
            <Menu.Item className={itemClass} disabled={pending} onSelect={() => startTransition(() => exitManagement())}>
              <ShieldCheck className="h-[18px] w-[18px] text-text-secondary" strokeWidth={1.5} aria-hidden="true" />
              Выключить режим управления
            </Menu.Item>
          ) : null}

          <Menu.Item
            className={itemClass}
            disabled={pending}
            onSelect={() =>
              startTransition(async () => {
                await forgetThisDevice(me.slug);
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
