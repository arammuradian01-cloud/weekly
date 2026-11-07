import { expect, it, vi } from "vitest";
vi.mock("../../src/lib/settings", () => ({ getSetting: vi.fn() }));
import { backupStatus } from "../../src/lib/backup-status";
it("не выдаёт включённую настройку за подтверждённую копию и отмечает просрочку и сбой", () => {
  const now = new Date("2026-11-06T12:00:00Z");
  const env = { BACKUP_ENABLED: "true", BACKUP_RESTORE_ENABLED: "true" };
  expect(backupStatus([null, null, null, null], now, env).copyStale).toBe(true);
  const fresh = ["2026-11-06T00:00:00Z", "2026-11-01T01:00:00Z", null, null];
  expect(backupStatus(fresh, now, env)).toMatchObject({ copyStale: false, checkStale: false });
  expect(backupStatus([fresh[0], fresh[1], "2026-11-06T02:00:00Z", null], now, env).copyStale).toBe(true);
  expect(backupStatus(["2026-11-04T00:00:00Z", "2026-10-01T00:00:00Z", null, null], now, env)).toMatchObject({ copyStale: true, checkStale: true });
  expect(backupStatus(["bad", {}, null, null], now, env)).toMatchObject({ copyAt: null, checkAt: null, copyStale: true });
  expect(backupStatus(fresh, now, {})).toMatchObject({ enabled: false, restoreEnabled: false });
});
