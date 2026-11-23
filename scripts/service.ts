import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { env, positiveInteger } from "../src/lib/config.ts";
import { connect, transaction } from "../src/lib/db.ts";

const command = process.argv[2] ?? "start";
const name: string = "checkin";
if (!["start", "migrate", "seed"].includes(command)) throw new Error("Comando inválido.");
try { process.loadEnvFile(resolve(import.meta.dirname, "../.env")); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
const pool = name === "notifications" ? undefined : connect();
const serviceDir = new URL("../migrations/", import.meta.url);
const migrations = pool
  ? (await readdir(serviceDir))
      .filter((file) => /^\d{3}-[a-z0-9-]+\.sql$/.test(file))
      .sort()
  : [];
const versions = migrations.map((file) => file.slice(0, -4));
if (command === "migrate" || command === "seed") {
  try {
    if (!pool || (command === "seed" && name !== "auth"))
      throw new Error("Comando no aplicable al servicio.");
    if (command === "migrate") {
      const applied = await transaction(pool, async (client) => {
        await client.query("SELECT pg_advisory_xact_lock(101)");
        await client.query(
          "CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY)",
        );
        const { rows } = await client.query<{ version: string }>(
          "SELECT version FROM schema_migrations",
        );
        const existing = new Set(rows.map(({ version }) => version));
        const added: string[] = [];
        for (const file of migrations) {
          const version = file.slice(0, -4);
          if (existing.has(version)) continue;
          const sql = await readFile(new URL(file, serviceDir), "utf8");
          await client.query(sql);
          await client.query(
            "INSERT INTO schema_migrations (version) VALUES ($1)",
            [version],
          );
          added.push(version);
        }
        return added;
      });
      console.log(
        applied.length
          ? `${name}: migraciones aplicadas (${applied.join(", ")}).`
          : `${name}: migraciones al día.`,
      );
    } else {
      const { seed } = await import(String("../src/index.ts"));
      await seed(pool);
      console.log("auth: cuentas ficticias preparadas.");
    }
  } finally {
    await pool?.end();
  }
} else {
  const { createApi, logger } = await import("../src/lib/api.ts");
  const log = logger(name, env("LOG_LEVEL"));
  const { mount } = await import(String("../src/index.ts"));
  const smtp = undefined;
  for (const key of ["TICKETS_PDF_DIR", "EVENTS_IMAGES_DIR"]) {
    if (process.env[key]) await mkdir(env(key), { recursive: true });
  }
  const api = createApi(log);
  api.route("getHealth", {}, async (_req, res) => {
    try {
      if (pool) {
        const applied = await pool.query(
          "SELECT version FROM schema_migrations WHERE version=ANY($1::text[])",
          [versions],
        );
        if (applied.rowCount !== versions.length)
          throw new Error("Migración local pendiente.");
      }
      if (name === "tickets") {
        const dir = env("TICKETS_PDF_DIR");
        if (!(await stat(dir)).isDirectory())
          throw new Error("Directorio de PDF inválido.");
        await access(dir, constants.R_OK | constants.W_OK | constants.X_OK);
      }
      if (name === "events") {
        const dir = env("EVENTS_IMAGES_DIR");
        if (!(await stat(dir)).isDirectory()) throw new Error("Directorio de imágenes inválido.");
        await access(dir, constants.R_OK | constants.W_OK | constants.X_OK);
      }

      res.json({ status: "ok" });
    } catch {
      log("warn", "Recurso de salud indisponible.");
      res.status(503).json({ status: "unavailable" });
    }
  });
  pool?.on("error", () =>
    log("warn", "Conexión inactiva de PostgreSQL interrumpida."),
  );
  mount(api, { pool, smtp, log });
  const server = api
    .finish()
    .listen(positiveInteger("PORT"), env("HOST"), () =>
      log("info", "Servidor iniciado."),
    );
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () =>
      server.close(async () => {
        await pool?.end();
      }),
    );
  }
}
