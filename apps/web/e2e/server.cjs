const { spawn, spawnSync } = require("node:child_process");
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
const child = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "dev", "--hostname", "127.0.0.1", "--port", "3107"], { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code) => process.exit(code ?? 1));
