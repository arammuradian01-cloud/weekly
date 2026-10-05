// Задать или сменить пароль: npm run password -- team | owner | admin
// Пароль вводится в терминале и не показывается. В базе хранится только bcrypt-хэш.
import "dotenv/config";
import readline from "node:readline";
import { prisma } from "../src/lib/db";
import { writeAudit } from "../src/lib/audit";
import { getSetting, setSetting } from "../src/lib/settings";
import {
  PASSWORD_SETTING_KEYS,
  hashPassword,
  validateNewPassword,
  verifyPassword,
  type PasswordKind,
} from "../src/lib/passwords";

const TITLES: Record<PasswordKind, string> = {
  team: "общий вход",
  owner: "режим управления владельца",
  admin: "режим управления администраторов",
};

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const writer = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    writer._writeToOutput = (s: string) => {
      if (!prompted) {
        writer.output.write(s);
        prompted = true;
      } else if (s.includes("\n") || s.includes("\r")) {
        writer.output.write("\n");
      } else {
        writer.output.write("*".repeat(s.length));
      }
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function main() {
  const kind = process.argv[2] as PasswordKind | undefined;
  if (!kind || !(kind in PASSWORD_SETTING_KEYS)) {
    console.error("Укажите, какой пароль задать: npm run password -- team | owner | admin");
    process.exitCode = 1;
    return;
  }

  let password = process.env.WEEKLY_NEW_PASSWORD;
  if (!password) {
    console.log(`Новый пароль: ${TITLES[kind]}. Не короче 12 символов. Символы на экране не показываются.`);
    password = await askHidden("Пароль: ");
    const repeat = await askHidden("Ещё раз: ");
    if (password !== repeat) {
      console.error("Пароли не совпали, ничего не изменено");
      process.exitCode = 1;
      return;
    }
  }

  const problem = validateNewPassword(password);
  if (problem) {
    console.error(`${problem}. Ничего не изменено`);
    process.exitCode = 1;
    return;
  }

  // Пароли трёх видов должны различаться, иначе разделение владельца и администраторов теряет смысл
  for (const other of Object.keys(PASSWORD_SETTING_KEYS) as PasswordKind[]) {
    if (other === kind) continue;
    const otherHash = await getSetting<string | null>(PASSWORD_SETTING_KEYS[other], null);
    if (await verifyPassword(password, otherHash)) {
      console.error(`Этот пароль уже используется: ${TITLES[other]}. Нужен другой`);
      process.exitCode = 1;
      return;
    }
  }

  await setSetting(PASSWORD_SETTING_KEYS[kind], await hashPassword(password));
  const epochKey = kind === "team" ? "auth.epoch" : "auth.managementEpoch";
  await setSetting(epochKey, (await getSetting<number>(epochKey, 1)) + 1);
  await writeAudit({ action: "password.set", source: "SYSTEM", after: { kind } });

  console.log(
    kind === "team"
      ? "Пароль общего входа задан. Все, кто был в ресурсе, войдут заново с новым паролем."
      : `Пароль задан: ${TITLES[kind]}. Включённые режимы управления выключены.`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
