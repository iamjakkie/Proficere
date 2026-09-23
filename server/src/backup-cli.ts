import fs from "node:fs";
import path from "node:path";
import { openDatabase } from "./db.js";
import { exportBackup } from "./store.js";
import { config } from "./config.js";

const db = openDatabase();
const backup = exportBackup(db);
const out = path.join(config.root, "data", `backup-${Date.now()}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(backup, null, 2));
console.log(`Wrote ${out}`);
