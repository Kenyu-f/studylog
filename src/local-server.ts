// Local development / Docker entry point (a long-running server).
// On Vercel this file is NOT used -- see api/index.ts instead.
//
//   export DATABASE_URL="postgresql://...neon.tech/...?sslmode=require"
//   npm run build && npm start
//   open http://localhost:8080

import { createApp } from "./studylog-app";
import { Store } from "./db";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set. Create a free Neon Postgres database and export its connection string.");
    process.exit(1);
  }
  const port = Number(process.env.PORT ?? "8080");

  const store = new Store(databaseUrl);
  await store.init();
  const app = createApp(store);

  app.listen(port, () => {
    console.log(`StudyLog listening on :${port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
