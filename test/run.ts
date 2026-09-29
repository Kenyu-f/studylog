// End-to-end test: boots the real Express app against an in-process
// Postgres (PGlite) through the same SqlFn seam Neon plugs into, then
// drives it over real HTTP. Verifies the actual SQL in src/db.ts is valid
// Postgres and every handler works with the async store.
//
//   npm test

import { PGlite } from "@electric-sql/pglite";
import assert from "assert";
import type { AddressInfo } from "net";
import { createApp } from "../src/studylog-app";
import { Store, SqlFn } from "../src/db";

async function main(): Promise<void> {
  const pg = new PGlite();
  const sql: SqlFn = async (strings, ...values) => {
    let text = strings[0];
    for (let i = 0; i < values.length; i++) text += `$${i + 1}` + strings[i + 1];
    const res = await pg.query(text, values as any[]);
    return res.rows as any[];
  };

  const store = new Store(sql);
  await store.init();
  await store.init(); // migrations must be idempotent (runs on every cold start)

  const server = createApp(store).listen(0);
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  let cookie = "";

  const req = async (method: string, path: string, body?: unknown, form?: Record<string, string>) => {
    const headers: Record<string, string> = {};
    if (cookie) headers.Cookie = cookie;
    let payload: string | undefined;
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      payload = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    }
    const res = await fetch(base + path, { method, headers, body: payload, redirect: "manual" });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return res;
  };
  const step = (name: string) => console.log("  ok -", name);

  // unauthenticated + first run
  assert.strictEqual((await req("GET", "/")).headers.get("location"), "/setup");
  assert.strictEqual((await req("GET", "/api/goals")).status, 401);
  step("redirects to /setup when no group; API is 401 when logged out");

  const setupRes = await req("POST", "/setup", undefined, {
    groupName: "Ken & Hasti",
    user1DisplayName: "Ken", user1Username: "ken", user1Password: "pass1234",
    user2DisplayName: "Hasti", user2Username: "hasti", user2Password: "pass1234",
  });
  const setupHtml = await setupRes.text();
  const codes = [...setupHtml.matchAll(/data-code="([A-Z0-9-]+)"/g)].map((m) => m[1]);
  assert.strictEqual(codes.length, 2);
  step("setup creates group + 2 users and shows 2 recovery codes");

  // login
  const bad = await req("POST", "/login", undefined, { username: "ken", password: "nope" });
  assert.ok((await bad.text()).includes("ユーザー名またはパスワードが違います"));
  const login = await req("POST", "/login", undefined, { username: "ken", password: "pass1234" });
  assert.strictEqual(login.status, 302);
  assert.ok(cookie.startsWith("studylog_session="));
  step("login rejects bad password, accepts good one, sets cookie");

  // goals
  const empty = await (await req("GET", "/api/goals")).json();
  assert.deepStrictEqual(empty, []);
  step("GET /api/goals is [] (not null) when empty");

  const parent = await (await req("POST", "/api/goals", { title: "〇〇大学院に受かる", type: "long-term", progressMode: "none" })).json();
  const child = await (await req("POST", "/api/goals", {
    title: "受験勉強", type: "short-term", parentGoalId: parent.id,
    progressMode: "rate", targetValue: 60, targetUnit: "min", targetPeriod: "day",
  })).json();
  const cum = await (await req("POST", "/api/goals", {
    title: "問題集", parentGoalId: child.id, progressMode: "cumulative",
    targetValue: 300, targetUnit: "min", targetPeriod: "total",
  })).json();
  assert.strictEqual(typeof child.shared, "boolean");
  step("parent / child / grandchild goals can be created");

  const dash = await (await req("GET", "/")).text();
  assert.ok(dash.includes(`value="${child.id}"`), "rate child goal is selectable for Grass");
  assert.ok(!dash.includes(`value="${parent.id}"`), "abstract parent is not");
  step("Grass selector lists only the measurable (rate) goal");

  // sessions + grass math
  const today = new Date().toISOString().slice(0, 10);
  const s1 = await req("POST", "/api/sessions", { date: today, durationMin: 30, goalId: child.id, subject: "Calculus" });
  const s2 = await req("POST", "/api/sessions", { date: today, durationMin: 15, goalId: child.id, description: "微分の演習" });
  assert.strictEqual(s1.status, 201);
  assert.strictEqual(s2.status, 201);
  assert.strictEqual((await req("POST", "/api/sessions", { date: today, durationMin: 0 })).status, 400);
  await req("POST", "/api/sessions", { date: today, durationMin: 90, goalId: cum.id });

  const year = today.slice(0, 4);
  const grass = await (await req("GET", `/api/grass?goalId=${child.id}&start=${year}-01-01&end=${year}-12-31`)).json();
  const cell = grass.cells.find((c: any) => c.date === today);
  assert.strictEqual(cell.actualMin, 45);
  assert.strictEqual(cell.ratio, 0.75);
  assert.strictEqual(cell.intensity, 0.75);
  step("two sessions on one day sum: 45/60 -> ratio 0.75, intensity 0.75");

  await req("POST", "/api/sessions", { date: today, durationMin: 60, goalId: child.id });
  const over = (await (await req("GET", `/api/grass?goalId=${child.id}&start=${today}&end=${today}`)).json()).cells[0];
  assert.strictEqual(over.ratio, 1.75);
  assert.strictEqual(over.intensity, 1);
  step("over-achievement: ratio 1.75 but intensity capped at 1");

  const goalsPage = await (await req("GET", "/goals")).text();
  assert.ok(goalsPage.includes("90 / 300"), "cumulative progress bar aggregates");
  step("cumulative goal progress renders (90 / 300 min)");

  const day = await (await req("GET", `/api/day?date=${today}`)).json();
  assert.strictEqual(day.sessions.length, 4);
  assert.ok(day.sessions.some((s: any) => s.goalTitle === "受験勉強" && s.userDisplayName === "Ken"));
  step("day detail returns sessions with goal titles + user names");

  // delete rules
  assert.strictEqual((await req("DELETE", `/api/goals/${parent.id}`)).status, 409);
  step("deleting a goal that has children is rejected (409)");

  // partner can see but not delete
  const kenCookie = cookie;
  await req("POST", "/login", undefined, { username: "hasti", password: "pass1234" });
  const seen = await (await req("GET", `/api/day?date=${today}`)).json();
  assert.strictEqual(seen.sessions.length, 4);
  const del = await req("DELETE", `/api/sessions/${seen.sessions[0].id}`);
  assert.strictEqual(del.status, 403);
  step("partner sees Ken's sessions but cannot delete them (403)");
  cookie = kenCookie;

  // forgot password
  cookie = "";
  const fail = await req("POST", "/forgot-password", undefined, {
    username: "ken", recoveryCode: "AAAA-AAAA-AAAA", newPassword: "newpass123", confirmPassword: "newpass123",
  });
  assert.ok((await fail.text()).includes("リカバリーコードが正しくありません"));
  const ok = await req("POST", "/forgot-password", undefined, {
    username: "ken", recoveryCode: codes[0].toLowerCase(), newPassword: "newpass123", confirmPassword: "newpass123",
  });
  const okHtml = await ok.text();
  const newCode = okHtml.match(/data-code="([A-Z0-9-]+)"/)![1];
  assert.notStrictEqual(newCode, codes[0]);
  assert.strictEqual((await req("POST", "/login", undefined, { username: "ken", password: "pass1234" })).status, 200);
  assert.strictEqual((await req("POST", "/login", undefined, { username: "ken", password: "newpass123" })).status, 302);
  const reuse = await req("POST", "/forgot-password", undefined, {
    username: "ken", recoveryCode: codes[0], newPassword: "another123", confirmPassword: "another123",
  });
  assert.ok((await reuse.text()).includes("リカバリーコードが正しくありません"));
  step("password reset: wrong code rejected, right code works, old pw dead, code rotates & is single-use");

  // logout
  await req("POST", "/logout");
  assert.strictEqual((await req("GET", "/api/goals")).status, 401);
  step("logout invalidates the session");

  // static assets + XSS escaping
  cookie = "";
  await req("POST", "/login", undefined, { username: "ken", password: "newpass123" });
  const css = await req("GET", "/static/css/style.css");
  assert.strictEqual(css.status, 200);
  await req("POST", "/api/goals", { title: "<script>alert(1)</script>" });
  const html = await (await req("GET", "/goals")).text();
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  step("static files served; user text is HTML-escaped in views");

  server.close();
  await pg.close();
  console.log("\nALL TESTS PASSED");
}

main().catch((e) => {
  console.error("\nTEST FAILED:", e);
  process.exit(1);
});
