import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

const root = path.resolve(import.meta.dirname, "../..");
dotenv.config({ path: path.join(root, ".env") });

export const config = {
  host: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 3001),
  databasePath:
    process.env.DATABASE_PATH ?? path.join(root, "data", "progress-island.db"),
  openRouterKey: process.env.OPENROUTER_API_KEY?.trim() ?? "",
  openRouterModel: process.env.OPENROUTER_MODEL?.trim() ?? "",
  clientOrigin: `http://127.0.0.1:${process.env.CLIENT_PORT ?? "5173"}`,
  libraryPath: process.env.LIBRARY_PATH?.trim() ?? "",
  root,
};

export function ensureDataDir(): void {
  fs.mkdirSync(path.dirname(path.resolve(config.databasePath)), { recursive: true });
}

export function aiConfigured(): boolean {
  return Boolean(config.openRouterKey && config.openRouterModel);
}
