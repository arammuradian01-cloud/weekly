import { expect, it } from "vitest";
import { backupCommand, BackupUsageError } from "../../scripts/lib/remote-backup/command";

it("создаёт копию только при отсутствии аргументов, различает чтение и справку", () => {
  expect(backupCommand([])).toEqual({ kind: "copy" });
  expect(backupCommand(["--help"])).toEqual({ kind: "help" });
  expect(backupCommand(["-h"])).toEqual({ kind: "help" });
  expect(backupCommand(["verify"])).toEqual({ kind: "verify", key: undefined });
  expect(backupCommand(["verify", "weekly/daily/test.wbk"])).toEqual({ kind: "verify", key: "weekly/daily/test.wbk" });
  expect(backupCommand(["extract", "weekly/daily/test.wbk", "/tmp/new.dump"])).toEqual({ kind: "extract", key: "weekly/daily/test.wbk", output: "/tmp/new.dump" });
});
it.each([["verfiy"], ["unknown"], ["--help", "extra"], ["verify", "one", "two"], ["verify", ""],
  ["verify", "--help"], ["extract"], ["extract", "key"], ["extract", "key", ""], ["extract", "key", "output", "extra"]])(
  "ошибка команды %j отклоняется, не превращаясь в создание копии", (...args) => {
    expect(() => backupCommand(args)).toThrow(BackupUsageError);
  },
);
