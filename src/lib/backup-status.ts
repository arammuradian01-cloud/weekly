import { getSetting } from "./settings";

export type BackupStatus = { enabled: boolean; restoreEnabled: boolean; copyAt: string | null; checkAt: string | null;
  copyFailedAt: string | null; checkFailedAt: string | null; copyStale: boolean; checkStale: boolean };

const date = (value: unknown): string | null => typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
export function backupStatus(values: unknown[], now: Date, env: Record<string, string | undefined> = process.env): BackupStatus {
  const [copyAt, checkAt, copyFailedAt, checkFailedAt] = values.map(date);
  const stale = (ok: string | null, failed: string | null, hours: number) => !ok ||
    now.getTime() - Date.parse(ok) > hours * 3_600_000 || !!(failed && Date.parse(failed) > Date.parse(ok));
  return { enabled: env.BACKUP_ENABLED === "true", restoreEnabled: env.BACKUP_RESTORE_ENABLED === "true",
    copyAt, checkAt, copyFailedAt, checkFailedAt, copyStale: stale(copyAt, copyFailedAt, 36), checkStale: stale(checkAt, checkFailedAt, 35 * 24) };
}

/** Только отметки внешнего резервирования: локальная копия не считается внешней. Адреса и ключи не читаются. */
export async function loadBackupStatus(now: Date): Promise<BackupStatus> {
  const values = await Promise.all(["copy.ok", "check.ok", "copy.failed", "check.failed"]
    .map((suffix) => getSetting<unknown>(`backup.remote.${suffix}`, null).catch(() => null)));
  return backupStatus(values, now);
}
