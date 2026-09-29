// Vercel serverless entry point. Vercel invokes this default export once
// per request; warm function instances are reused across requests, so
// the app + DB migration are initialized once per instance (cached in a
// module-level promise) rather than on every request.
//
// vercel.json rewrites *every* path to this single function, and Express
// does the actual routing internally -- same route table as local.

import type { IncomingMessage, ServerResponse } from "http";
import { createApp } from "../src/app";
import { Store } from "../src/db";

let appPromise: Promise<ReturnType<typeof createApp>> | null = null;

function getApp(): Promise<ReturnType<typeof createApp>> {
  if (!appPromise) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      return Promise.reject(new Error("DATABASE_URL is not set (add it in Vercel: Project Settings -> Environment Variables)"));
    }
    const store = new Store(databaseUrl);
    appPromise = store.init().then(() => createApp(store));
    // If init fails (e.g. transient network error), don't cache the failure.
    appPromise.catch(() => {
      appPromise = null;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const app = await getApp();
    app(req as any, res as any);
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.end("Server misconfigured: " + (err instanceof Error ? err.message : "unknown error"));
  }
}
