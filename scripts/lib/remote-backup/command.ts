export const BACKUP_USAGE = "Использование: backup-remote [--help | verify [ключ] | extract ключ новый-файл]. Без аргументов — создание копии.";
export class BackupUsageError extends Error {}
export type BackupCommand = { kind: "copy" | "help" } | { kind: "verify"; key?: string } | { kind: "extract"; key: string; output: string };

/** Разбор полностью завершается до настройки базы и хранилища: опечатка не должна запускать запись. */
export function backupCommand(args: string[]): BackupCommand {
  if (args.length === 0) return { kind: "copy" };
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) return { kind: "help" };
  if (args[0] === "verify" && (args.length === 1 || args.length === 2 && args[1].length > 0 && !args[1].startsWith("-"))) {
    return { kind: "verify", key: args[1] };
  }
  if (args[0] === "extract" && args.length === 3 && args.slice(1).every((arg) => arg.length > 0 && !arg.startsWith("-"))) {
    return { kind: "extract", key: args[1], output: args[2] };
  }
  throw new BackupUsageError(BACKUP_USAGE);
}
