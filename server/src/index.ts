import { createApp } from "./app.js";
import { cacheRemoteCovers } from "./covers.js";
import { config } from "./config.js";
import { openDatabase } from "./db.js";
import { startExerciseSearch } from "./exercise-search.js";

const db = openDatabase();
startExerciseSearch(db);
const app = createApp(db);
void cacheRemoteCovers(db).then((stored) => {
  if (stored > 0) console.log(`Stored ${stored} book cover${stored === 1 ? "" : "s"} on this Mac.`);
});

app.listen(config.port, config.host, () => {
  console.log(`Proficere API on http://${config.host}:${config.port}`);
  if (!config.openRouterKey || !config.openRouterModel) {
    console.log("OpenRouter is not configured. Tracking works; AI actions are disabled.");
  }
});
