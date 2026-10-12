const { spawn, spawnSync } = require("node:child_process");
const { appendFileSync, mkdirSync, writeFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { pathToFileURL } = require("node:url");

// Blank values override .env.local. Never connect this suite to hosted data or providers.
const env = { ...process.env,
  DATABASE_URL: "", DIRECT_URL: "", NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:3107", NEXT_PUBLIC_SUPABASE_ANON_KEY: "",
  SUPABASE_SERVICE_ROLE_KEY: "", DEV_AUTH_EMAIL: "russellharrisrei@gmail.com",
  PROPERTY_DATA_PROVIDER: "mock", MESSAGING_PROVIDER: "mock", EMAIL_PROVIDER: "mock",
  VOICE_PROVIDER: "mock", JUDGMENT_PROVIDER: "mock", CRON_SECRET: "local-e2e-only",
  APP_URL: "http://127.0.0.1:3107", DEMO_MODE: "true",
  PGLITE_DATA_DIR: resolve(__dirname, "../../..", ".pglite", `e2e-${Date.now()}`),
};
const seed = spawnSync(process.execPath, ["--import", pathToFileURL(require.resolve("tsx")).href, resolve(__dirname, "seed.ts")], { env, stdio: "inherit" });
if (seed.status !== 0) process.exit(seed.status ?? 1);
// The server prints mock one-time codes to stdout. Echo all output and append those lines to a file the forms spec reads.
const codesFile = resolve(__dirname, "../../..", ".pglite", "e2e-codes.log");
mkdirSync(resolve(codesFile, ".."), { recursive: true });
writeFileSync(codesFile, "");
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3107"], { env, stdio: ["inherit", "pipe", "pipe"] });
function tap(stream, sink) {
  let rest = "";
  stream.on("data", (chunk) => {
    sink.write(chunk);
    rest += chunk.toString();
    const lines = rest.split(String.fromCharCode(10));
    rest = lines.pop() || "";
    for (const line of lines) if (line.includes("[forms] mock one-time code")) appendFileSync(codesFile, line.trim() + String.fromCharCode(10));
  });
}
tap(child.stdout, process.stdout);
tap(child.stderr, process.stderr);
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
