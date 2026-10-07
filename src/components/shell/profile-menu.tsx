"use client";

import Link from "next/link";
import { useTransition } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, KeyRound, CircleHelp, LayoutGrid, LogOut, ShieldCheck, UserRound, Users } from "lucide-react";
import { exitManagement, logout } from "@/app/actions/auth";
import { MANAGEMENT_NAV } from "./nav";
import { cn } from "@/lib/cn";
import { ThemeSwitch } from "./theme-switch";

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

const itemClass =
  "flex h-11 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-body text-ink outline-none data-[highlighted]:bg-field";

export function ProfileMenu({ fullName, shortName, roleLabel, canManage, management, managementUntil, personal, tone = "dark" }: Props) {
  const [pending, startTransition] = useTransition();
  const dark = tone === "dark";

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors",
          dark ? "text-sidebar-text hover:bg-sidebar-hover" : "text-ink hover:bg-field",
        )}
        aria-label={`Профиль: ${fullName}`}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-caption font-semibold",
            dark ? "bg-sidebar-active text-sidebar-text" : "bg-navy text-white",
          )}
        >
          {initials(fullName)}
        </span>
        <span className={cn("min-w-0 flex-1 leading-tight", tone === "light" && "hidden sm:block")}>
          <span className="block truncate text-body font-semibold">{shortName}</span>
          <span className={cn("block truncate text-caption", dark ? "text-sidebar-muted" : "text-muted")}>
            {management ? "Режим управления" : roleLabel}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0", dark ? "text-sidebar-muted" : "text-muted")} aria-hidden="true" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-menu"
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
                    <item.icon className="h-5 w-5 text-muted" aria-hidden="true" />
                    {item.label}
                  </Link>
                </Menu.Item>
              ))}
              <Menu.Separator className="my-1 h-px bg-line" />
            </div>
          ) : null}

          <Menu.Item asChild>
            <Link href="/profile" className={itemClass}>
              <UserRound className="h-5 w-5 text-muted" aria-hidden="true" />
              Профиль и входы
            </Link>
          </Menu.Item>

          <Menu.Item asChild>
            <Link href="/help" className={itemClass}>
              <CircleHelp className="h-5 w-5 text-muted" aria-hidden="true" />
              Как работать
            </Link>
          </Menu.Item>

          {/* Образец компонентов нужен разработке и управлению, команде в меню он только мешает */}
          {management ? (
            <Menu.Item asChild>
              <Link href="/ui" className={itemClass}>
                <LayoutGrid className="h-5 w-5 text-muted" aria-hidden="true" />
                Образец компонентов
              </Link>
            </Menu.Item>
          ) : null}

          {personal ? null : (
            <Menu.Item asChild>
              <Link href="/choose" className={itemClass}>
                <Users className="h-5 w-5 text-muted" aria-hidden="true" />
                Сменить профиль
              </Link>
            </Menu.Item>
          )}

          {canManage && !management ? (
            <Menu.Item asChild>
              <Link href="/manage" className={itemClass}>
                <KeyRound className="h-5 w-5 text-muted" aria-hidden="true" />
                Включить режим управления
              </Link>
            </Menu.Item>
          ) : null}

          {management ? (
            <Menu.Item className={itemClass} disabled={pending} onSelect={() => startTransition(() => exitManagement())}>
              <ShieldCheck className="h-5 w-5 text-muted" aria-hidden="true" />
              Выключить режим управления
            </Menu.Item>
          ) : null}

          <Menu.Item className={itemClass} disabled={pending} onSelect={() => startTransition(() => logout())}>
            <LogOut className="h-5 w-5 text-muted" aria-hidden="true" />
            Выйти
          </Menu.Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
