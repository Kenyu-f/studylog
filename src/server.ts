// Entry point. See explanation.md for the full design writeup.
//
//   npm install
//   npm run build && npm start
//   open http://localhost:8080
//
// Cloud deployment: reads $PORT / $DATA_PATH, same convention as the Go
// version, so it works unmodified on Railway/Fly/Deplexo/etc.

import { createApp } from "./app";
import { Store } from "./db";

const port = process.env.PORT ?? "8080";
const dataPath = process.env.DATA_PATH ?? "data/studylog.db";

const store = new Store(dataPath);
const app = createApp(store);

app.listen(Number(port), () => {
  console.log(`StudyLog listening on :${port} (data file: ${dataPath})`);
});
