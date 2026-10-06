"use client";

import Link from "next/link";
import { useTransition } from "react";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, KeyRound, CircleHelp, LayoutGrid, LogOut, ShieldCheck, UserRound, Users } from "lucide-react";
import { exitManagement, logout } from "@/app/actions/auth";
import { MANAGEMENT_NAV } from "./nav";
import { cn } from "@/lib/cn";

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
  "flex h-11 cursor-pointer select-none items-center gap-3 rounded-md px-3 text-[15px] text-ink outline-none data-[highlighted]:bg-surface";

export function ProfileMenu({ fullName, shortName, roleLabel, canManage, management, managementUntil, personal, tone = "dark" }: Props) {
  const [pending, startTransition] = useTransition();
  const dark = tone === "dark";

  return (
    <Menu.Root>
      <Menu.Trigger
        className={cn(
          "flex h-12 w-full items-center gap-3 rounded-lg px-2 text-left transition-colors",
          dark ? "text-white hover:bg-white/8" : "text-ink hover:bg-surface",
        )}
        aria-label={`Профиль: ${fullName}`}
      >
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold",
            dark ? "bg-white/12 text-white" : "bg-navy text-white",
          )}
        >
          {initials(fullName)}
        </span>
        <span className={cn("min-w-0 flex-1 leading-tight", tone === "light" && "hidden sm:block")}>
          <span className="block truncate text-[15px] font-semibold">{shortName}</span>
          <span className={cn("block truncate text-[13px]", dark ? "text-white/60" : "text-muted")}>
            {management ? "Режим управления" : roleLabel}
          </span>
        </span>
        <ChevronDown className={cn("h-4 w-4 shrink-0", dark ? "text-white/60" : "text-muted")} aria-hidden="true" />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content
          align="end"
          sideOffset={8}
          className="z-50 w-72 rounded-xl border border-line bg-white p-1.5 shadow-[0_12px_32px_-12px_rgba(0,42,58,0.35)]"
        >
          <div className="px-3 pb-2 pt-1.5">
            <div className="text-[15px] font-semibold text-ink">{fullName}</div>
            <div className="text-[13px] text-muted">{roleLabel}</div>
            {management && managementUntil ? (
              <div className="mt-1 text-[13px] text-blue-700">Режим управления до {managementUntil}</div>
            ) : null}
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
