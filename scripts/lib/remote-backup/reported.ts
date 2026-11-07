import { createRemoteBackup, verifyRemoteBackup } from "./core";
import type { BackupConfig } from "./config";
import { writeAudit } from "../../../src/lib/audit";
import { setSetting } from "../../../src/lib/settings";
import { recordError } from "../../../src/lib/errors";

/** Ручной запуск и расписание оставляют одинаковые отметки; копия до миграций не заменяет ежедневную. */
export async function performReportedBackup(check: boolean, config: BackupConfig, key?: string): Promise<{ tables: number }> {
  const kind = check ? "check" : "copy";
  try {
    const result = check ? await verifyRemoteBackup(key, { config }) : await createRemoteBackup("daily", { config });
    await setSetting(`backup.remote.${kind}.ok`, new Date().toISOString());
    await writeAudit({ action: check ? "backup.check.ok" : "backup.done", source: "SYSTEM", after: { external: true, tables: result.tables } });
    return result;
  } catch {
    const message = check ? "Не удалось восстановить и сверить внешнюю копию" : "Не удалось подтвердить внешнюю резервную копию";
    await setSetting(`backup.remote.${kind}.failed`, new Date().toISOString()).catch(() => undefined);
    await writeAudit({ action: check ? "backup.check.failed" : "backup.failed", source: "SYSTEM", after: { external: true, error: message } }).catch(() => undefined);
    await recordError({ source: "SERVER", place: "backup-worker", message }).catch(() => undefined);
    throw new Error(message);
  }
}
