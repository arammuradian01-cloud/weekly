"use client";

import { useState } from "react";
import { LogOut, MonitorSmartphone } from "lucide-react";
import type { DeviceView } from "@/lib/login/service";
import { deviceLabel } from "@/lib/login/device-label";
import { LOGIN_METHOD_LABELS } from "@/lib/login/labels";
import { revokeAllMineAction, revokeDeviceAction } from "@/app/(app)/profile/actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Modal } from "@/components/ui/overlays";
import { useRunWeekly as useRunAction } from "@/components/weekly/use-weekly";
import { usePrototype } from "@/domain/store";

const when = (iso: string) =>
  new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));

/** Свои личные входы: устройство, способ входа, когда заходили. Выход на одном устройстве или на всех */
export function DeviceList({ devices, current }: { devices: DeviceView[]; current: string | null }) {
  const run = useRunAction();
  const { notify } = usePrototype();
  const [confirmAll, setConfirmAll] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-4 flex flex-col gap-4">
      <ul className="flex flex-col divide-y divide-line rounded-xl ring-1 ring-line">
        {devices.map((d) => (
          <li key={d.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-start gap-3">
              <MonitorSmartphone className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-body font-medium text-ink">
                  {deviceLabel(d.userAgent)}
                  {d.id === current ? <Badge tone="blue">Это устройство</Badge> : null}
                </p>
                <p className="text-caption text-muted">
                  Вход {when(d.createdAt)}, {LOGIN_METHOD_LABELS[d.method]}. Последний раз {when(d.lastSeenAt)}
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const ok = await run(() => revokeDeviceAction(d.id));
                setBusy(false);
                if (ok !== null) notify("Вход на устройстве завершён");
              }}
            >
              {d.id === current ? "Выйти здесь" : "Завершить"}
            </Button>
          </li>
        ))}
      </ul>
      <div>
        <Button variant="danger" onClick={() => setConfirmAll(true)} disabled={busy}>
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Выйти на всех устройствах
        </Button>
        <p className="mt-2 text-caption text-muted">Если потеряли телефон или переслали ссылку не тому. Неиспользованные ссылки для входа тоже перестанут работать.</p>
      </div>
      <Modal open={confirmAll} onOpenChange={setConfirmAll} title="Выйти на всех устройствах?">
        <p className="text-small text-muted">Вход завершится на всех устройствах, и на этом тоже. Снова войти можно со своим логином и паролем. Если пароль мог узнать кто-то другой, сначала смените его в разделе «Пароль».</p>
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => setConfirmAll(false)}>
            Остаться
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await run(() => revokeAllMineAction());
              setBusy(false);
              setConfirmAll(false);
            }}
          >
            Выйти везде
          </Button>
        </div>
      </Modal>
    </div>
  );
}
