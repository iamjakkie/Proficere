import { createApp } from "./app.js";
import { cacheRemoteCovers } from "./covers.js";
import { config } from "./config.js";
import { openDatabase } from "./db.js";

const db = openDatabase();
const app = createApp(db);
void cacheRemoteCovers(db).then((stored) => {
  if (stored > 0) console.log(`Stored ${stored} book cover${stored === 1 ? "" : "s"} on this Mac.`);
});

app.listen(config.port, config.host, () => {
  console.log(`Progress Island API on http://${config.host}:${config.port}`);
  if (!config.openRouterKey || !config.openRouterModel) {
    console.log("OpenRouter is not configured. Tracking works; AI actions are disabled.");
  }
});
