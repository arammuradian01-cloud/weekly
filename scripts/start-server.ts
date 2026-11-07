import { spawn, type ChildProcess } from "node:child_process";

// Один контейнер, два отдельных процесса. Отказ процесса копий виден платформе и не остаётся незаметным.
const children: ChildProcess[] = [];
let stopping = false;
function stop(code: number) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
  const timer = setTimeout(() => {
    for (const child of children) child.kill("SIGKILL");
    process.exit(code);
  }, 15_000);
  timer.unref();
  Promise.all(children.map((child) => child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve() : new Promise<void>((resolve) => child.once("exit", () => resolve()))))
    .then(() => { clearTimeout(timer); process.exit(code); });
}
function start(args: string[], name: string) {
  const child = spawn(process.execPath, args, { stdio: "inherit", env: process.env });
  children.push(child);
  child.on("error", () => { console.error(`Не запустился процесс ${name}`); stop(1); });
  child.on("exit", (code) => { if (!stopping) { console.error(`Завершился процесс ${name}`); stop(code || 1); } });
}
const heap = Number(process.env.NODE_HEAP_MB || "320");
if (!Number.isInteger(heap) || heap < 128 || heap > 16384) throw new Error("Некорректный NODE_HEAP_MB");
start([`--max-old-space-size=${heap}`, "node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", process.env.PORT || "3000"], "сайта");
if (process.env.BACKUP_ENABLED === "true") start(["--max-old-space-size=192", "dist/start/scripts/worker.mjs"], "резервирования");
process.on("SIGTERM", () => stop(0));
process.on("SIGINT", () => stop(0));
