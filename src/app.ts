// HTTP layer -- Vercel edition. Same route table and handler logic as
// the Deplexo version, with one structural change throughout: every
// handler is now `async` and every store call is `await`ed, since
// src/db.ts's Neon-backed Store is Promise-based (see explanation.md,
// "Adapting for Vercel"). An `asyncHandler` wrapper forwards rejected
// promises to Express's error handler, since Express 4 doesn't do this
// automatically for async route handlers.

import express, { Request, Response, NextFunction } from "express";
import path from "path";
import crypto from "crypto";
import { Store, NotFoundError } from "./db";
import * as authutil from "./auth";
import * as grassLib from "./grass";
import { User, Goal, StudySession } from "./models";

const SESSION_COOKIE = "studylog_session";

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

type AsyncRouteHandler = (req: Request, res: Response, next: NextFunction) => Promise<void>;

function asyncHandler(fn: AsyncRouteHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

// ---------- tiny cookie helpers (no cookie-parser dependency) ----------

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie;
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function setSessionCookie(res: Response, token: string): void {
  const maxAge = 60 * 60 * 24 * 90; // 90 days
  res.append("Set-Cookie", `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);
}

function clearSessionCookie(res: Response): void {
  res.append("Set-Cookie", `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export function createApp(store: Store): express.Express {
  const app = express();
  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "views"));

  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use("/static", express.static(path.join(process.cwd(), "public")));

  // ---------- auth plumbing ----------

  async function currentUser(req: Request): Promise<User | null> {
    const token = parseCookies(req)[SESSION_COOKIE];
    if (!token) return null;
    const userId = await store.userIdForToken(token);
    if (!userId) return null;
    try {
      return await store.userById(userId);
    } catch {
      return null;
    }
  }

  function withAuth(next: (req: Request, res: Response, user: User) => Promise<void>) {
    return asyncHandler(async (req, res) => {
      if (!(await store.anyGroupExists())) {
        res.redirect("/setup");
        return;
      }
      const u = await currentUser(req);
      if (!u) {
        res.redirect("/login");
        return;
      }
      await next(req, res, u);
    });
  }

  function withAuthJson(next: (req: Request, res: Response, user: User) => Promise<void>) {
    return asyncHandler(async (req, res) => {
      const u = await currentUser(req);
      if (!u) {
        res.status(401).json({ error: "not authenticated" });
        return;
      }
      await next(req, res, u);
    });
  }

  // ---------- setup (first run) ----------

  app.get(
    "/setup",
    asyncHandler(async (req, res) => {
      if (await store.anyGroupExists()) {
        res.redirect("/login");
        return;
      }
      res.render("setup", { title: "Set up StudyLog", error: null });
    })
  );

  app.post(
    "/setup",
    asyncHandler(async (req, res) => {
      if (await store.anyGroupExists()) {
        res.redirect("/login");
        return;
      }
      const b = req.body as Record<string, string>;
      const groupName = b.groupName ?? "";
      const specs = [
        { display: b.user1DisplayName ?? "", username: b.user1Username ?? "", password: b.user1Password ?? "" },
        { display: b.user2DisplayName ?? "", username: b.user2Username ?? "", password: b.user2Password ?? "" },
      ];
      if (!groupName || specs.some((s) => !s.username || !s.password)) {
        res.render("setup", { title: "Set up StudyLog", error: "全ての必須項目を入力してください。" });
        return;
      }

      const group = { id: newId("grp"), name: groupName, createdAt: new Date().toISOString() };
      await store.createGroup(group);

      const items: { label: string; code: string }[] = [];
      for (const spec of specs) {
        const salt = authutil.newSalt();
        const recoveryCode = authutil.newRecoveryCode();
        const recoverySalt = authutil.newSalt();
        const displayName = spec.display || spec.username;
        const user: User = {
          id: newId("usr"),
          username: spec.username,
          displayName,
          passwordHash: authutil.hashPassword(spec.password, salt),
          salt,
          recoveryCodeHash: authutil.hashPassword(recoveryCode, recoverySalt),
          recoveryCodeSalt: recoverySalt,
          groupId: group.id,
          createdAt: new Date().toISOString(),
        };
        await store.createUser(user);
        items.push({ label: `${displayName} (${user.username})`, code: recoveryCode });
      }

      res.render("recovery-codes", {
        title: "Save your recovery codes",
        heading: "リカバリーコードを保存してください",
        subtitle:
          "パスワードを忘れた場合、このコードだけが再設定の手段になります。メール機能は無いため、二人ともスクリーンショットやメモアプリに保存しておくことを強くおすすめします。",
        items,
        nextUrl: "/login",
        nextLabel: "保存しました。ログインへ進む",
      });
    })
  );

  // ---------- login/logout ----------

  app.get(
    "/login",
    asyncHandler(async (req, res) => {
      if (!(await store.anyGroupExists())) {
        res.redirect("/setup");
        return;
      }
      if (await currentUser(req)) {
        res.redirect("/");
        return;
      }
      res.render("login", { title: "Log in", error: null });
    })
  );

  app.post(
    "/login",
    asyncHandler(async (req, res) => {
      const { username, password } = req.body as Record<string, string>;
      let user: User;
      try {
        user = await store.userByUsername(username ?? "");
      } catch {
        res.render("login", { title: "Log in", error: "ユーザー名またはパスワードが違います。" });
        return;
      }
      if (!authutil.verifyPassword(password ?? "", user.salt, user.passwordHash)) {
        res.render("login", { title: "Log in", error: "ユーザー名またはパスワードが違います。" });
        return;
      }
      const token = authutil.newSessionToken();
      await store.putToken(token, user.id);
      setSessionCookie(res, token);
      res.redirect(303, "/");
    })
  );

  app.post(
    "/logout",
    asyncHandler(async (req, res) => {
      const token = parseCookies(req)[SESSION_COOKIE];
      if (token) await store.deleteToken(token);
      clearSessionCookie(res);
      res.redirect(303, "/login");
    })
  );

  // ---------- forgot password ----------

  app.get(
    "/forgot-password",
    asyncHandler(async (req, res) => {
      if (!(await store.anyGroupExists())) {
        res.redirect("/setup");
        return;
      }
      res.render("forgot-password", { title: "Reset password", error: null, username: "" });
    })
  );

  app.post(
    "/forgot-password",
    asyncHandler(async (req, res) => {
      const b = req.body as Record<string, string>;
      const username = b.username ?? "";
      const recoveryCode = (b.recoveryCode ?? "").trim().toUpperCase();
      const newPassword = b.newPassword ?? "";
      const confirmPassword = b.confirmPassword ?? "";

      const fail = (msg: string) => res.render("forgot-password", { title: "Reset password", error: msg, username });

      if (!newPassword || newPassword !== confirmPassword) {
        fail("新しいパスワードが一致しません。");
        return;
      }
      if (newPassword.length < 8) {
        fail("パスワードは8文字以上にしてください。");
        return;
      }

      let user: User;
      try {
        user = await store.userByUsername(username);
      } catch {
        fail("ユーザー名またはリカバリーコードが正しくありません。");
        return;
      }
      if (!user.recoveryCodeHash || !authutil.verifyPassword(recoveryCode, user.recoveryCodeSalt, user.recoveryCodeHash)) {
        fail("ユーザー名またはリカバリーコードが正しくありません。");
        return;
      }

      const newSalt = authutil.newSalt();
      const newRecoveryCode = authutil.newRecoveryCode();
      const newRecoverySalt = authutil.newSalt();
      user.passwordHash = authutil.hashPassword(newPassword, newSalt);
      user.salt = newSalt;
      user.recoveryCodeHash = authutil.hashPassword(newRecoveryCode, newRecoverySalt);
      user.recoveryCodeSalt = newRecoverySalt;
      await store.updateUser(user);

      res.render("recovery-codes", {
        title: "New recovery code",
        heading: "パスワードを再設定しました",
        subtitle: "念のため、リカバリーコードも新しいものに更新しました。古いコードはもう使えません。新しいコードを保存してください。",
        items: [{ label: `${user.displayName} (${user.username})`, code: newRecoveryCode }],
        nextUrl: "/login",
        nextLabel: "保存しました。ログインへ進む",
      });
    })
  );

  // ---------- pages ----------

  app.get(
    "/",
    withAuth(async (req, res, u) => {
      const goalsList = await store.goalsInGroup(u.groupId);
      const rateGoals = goalsList
        .filter((g) => g.progressMode === "rate" && g.targetPeriod === "day" && g.targetValue > 0)
        .sort((a, b) => a.title.localeCompare(b.title));
      const partners = await store.usersInGroup(u.groupId);

      res.render("dashboard", {
        title: "StudyLog",
        active: "grass",
        user: u,
        partners,
        rateGoals,
        today: new Date().toISOString().slice(0, 10),
      });
    })
  );

  app.get(
    "/goals",
    withAuth(async (req, res, u) => {
      const goalsList = await store.goalsInGroup(u.groupId);
      const sessions = await store.sessionsInGroup(u.groupId);
      const tree = grassLib.sortGoalsForTree(goalsList);
      const partners = await store.usersInGroup(u.groupId);
      const nameById = new Map(partners.map((p) => [p.id, p.displayName]));

      const rows = tree.map((n) => ({
        node: n,
        progress: grassLib.computeProgress(n.goal, goalsList, sessions),
        ownerTag: n.goal.shared ? "Shared" : nameById.get(n.goal.ownerId) ?? "",
      }));

      res.render("goals", { title: "Goals", active: "goals", user: u, rows, allGoals: goalsList });
    })
  );

  // ---------- API: goals ----------

  interface GoalInput {
    parentGoalId?: string;
    title?: string;
    description?: string;
    type?: string;
    progressMode?: string;
    targetValue?: number;
    targetUnit?: string;
    targetPeriod?: string;
    shared?: boolean;
    deadline?: string;
  }

  app.get(
    "/api/goals",
    withAuthJson(async (req, res, u) => {
      res.json(await store.goalsInGroup(u.groupId));
    })
  );

  app.post(
    "/api/goals",
    withAuthJson(async (req, res, u) => {
      const inBody = req.body as GoalInput;
      if (!inBody.title) {
        res.status(400).json({ error: "title is required" });
        return;
      }
      const now = new Date().toISOString();
      const shared = !!inBody.shared;
      const goal: Goal = {
        id: newId("goal"),
        groupId: u.groupId,
        ownerId: shared ? "" : u.id,
        shared,
        parentGoalId: inBody.parentGoalId ?? "",
        title: inBody.title,
        description: inBody.description ?? "",
        type: (inBody.type as Goal["type"]) || "short-term",
        progressMode: (inBody.progressMode as Goal["progressMode"]) || "none",
        targetValue: inBody.targetValue ?? 0,
        targetUnit: inBody.targetUnit ?? "",
        targetPeriod: inBody.targetPeriod || "day",
        deadline: inBody.deadline || null,
        createdAt: now,
        updatedAt: now,
      };
      await store.createGoal(goal);
      res.status(201).json(goal);
    })
  );

  app.put(
    "/api/goals/:id",
    withAuthJson(async (req, res, u) => {
      let existing: Goal;
      try {
        existing = await store.goalById(req.params.id);
      } catch {
        res.status(404).json({ error: "goal not found" });
        return;
      }
      if (existing.groupId !== u.groupId) {
        res.status(404).json({ error: "goal not found" });
        return;
      }
      const inBody = req.body as GoalInput;
      existing.parentGoalId = inBody.parentGoalId ?? "";
      existing.title = inBody.title ?? existing.title;
      existing.description = inBody.description ?? "";
      existing.type = (inBody.type as Goal["type"]) || existing.type;
      existing.progressMode = (inBody.progressMode as Goal["progressMode"]) || existing.progressMode;
      existing.targetValue = inBody.targetValue ?? 0;
      existing.targetUnit = inBody.targetUnit ?? "";
      existing.targetPeriod = inBody.targetPeriod || existing.targetPeriod;
      existing.shared = !!inBody.shared;
      if (existing.shared) {
        existing.ownerId = "";
      } else if (!existing.ownerId) {
        existing.ownerId = u.id;
      }
      existing.deadline = inBody.deadline || null;
      await store.updateGoal(existing);
      res.json(existing);
    })
  );

  app.delete(
    "/api/goals/:id",
    withAuthJson(async (req, res, u) => {
      let existing: Goal;
      try {
        existing = await store.goalById(req.params.id);
      } catch {
        res.status(404).json({ error: "goal not found" });
        return;
      }
      if (existing.groupId !== u.groupId) {
        res.status(404).json({ error: "goal not found" });
        return;
      }
      if ((await store.childGoals(req.params.id)).length > 0) {
        res.status(409).json({ error: "delete or move child goals first" });
        return;
      }
      await store.deleteGoal(req.params.id);
      res.status(204).end();
    })
  );

  // ---------- API: grass ----------

  app.get(
    "/api/grass",
    withAuthJson(async (req, res, u) => {
      const goalId = String(req.query.goalId ?? "");
      const start = String(req.query.start ?? "");
      const end = String(req.query.end ?? "");

      let goal: Goal;
      try {
        goal = await store.goalById(goalId);
      } catch {
        res.status(404).json({ error: "goal not found" });
        return;
      }
      if (goal.groupId !== u.groupId) {
        res.status(404).json({ error: "goal not found" });
        return;
      }
      let dates: string[];
      try {
        dates = grassLib.dateRange(start, end);
      } catch {
        res.status(400).json({ error: "invalid start/end" });
        return;
      }
      const sessions = await store.sessionsInGroup(u.groupId);
      const cells = grassLib.buildCells(goal, sessions, dates);
      res.json({ goal, cells });
    })
  );

  // ---------- API: day detail ----------

  app.get(
    "/api/day",
    withAuthJson(async (req, res, u) => {
      const date = String(req.query.date ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "invalid date" });
        return;
      }
      const sessions = (await store.sessionsForDate(u.groupId, date)).sort((a, b) =>
        a.createdAt.localeCompare(b.createdAt)
      );

      const partners = await store.usersInGroup(u.groupId);
      const nameById = new Map(partners.map((p) => [p.id, p.displayName]));

      const out = [];
      for (const s of sessions) {
        let goalTitle = "";
        if (s.goalId) {
          try {
            goalTitle = (await store.goalById(s.goalId)).title;
          } catch {
            /* goal may have been deleted; leave title blank */
          }
        }
        out.push({ ...s, userDisplayName: nameById.get(s.userId) ?? "", goalTitle });
      }

      res.json({ date, sessions: out });
    })
  );

  // ---------- API: sessions ----------

  interface SessionInput {
    date?: string;
    durationMin?: number;
    subject?: string;
    goalId?: string;
    description?: string;
  }

  app.post(
    "/api/sessions",
    withAuthJson(async (req, res, u) => {
      const inBody = req.body as SessionInput;
      if (!inBody.date || !/^\d{4}-\d{2}-\d{2}$/.test(inBody.date)) {
        res.status(400).json({ error: "invalid date" });
        return;
      }
      const duration = inBody.durationMin ?? 0;
      if (duration < 0) {
        res.status(400).json({ error: "duration must be >= 0" });
        return;
      }
      const description = inBody.description ?? "";
      if (duration === 0 && !description) {
        res.status(400).json({ error: "record either a duration or a description" });
        return;
      }
      if (inBody.goalId) {
        try {
          const g = await store.goalById(inBody.goalId);
          if (g.groupId !== u.groupId) throw new NotFoundError();
        } catch {
          res.status(400).json({ error: "unknown goal" });
          return;
        }
      }
      const now = new Date().toISOString();
      const session: StudySession = {
        id: newId("sess"),
        userId: u.id,
        groupId: u.groupId,
        date: inBody.date,
        durationMin: duration,
        subject: inBody.subject ?? "",
        goalId: inBody.goalId ?? "",
        description,
        createdAt: now,
        updatedAt: now,
      };
      await store.createSession(session);
      res.status(201).json(session);
    })
  );

  app.put(
    "/api/sessions/:id",
    withAuthJson(async (req, res, u) => {
      let existing: StudySession;
      try {
        existing = await store.sessionById(req.params.id);
      } catch {
        res.status(404).json({ error: "session not found" });
        return;
      }
      if (existing.groupId !== u.groupId) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      if (existing.userId !== u.id) {
        res.status(403).json({ error: "cannot edit a partner's session" });
        return;
      }
      const inBody = req.body as SessionInput;
      if (!inBody.date || !/^\d{4}-\d{2}-\d{2}$/.test(inBody.date)) {
        res.status(400).json({ error: "invalid date" });
        return;
      }
      const duration = inBody.durationMin ?? 0;
      const description = inBody.description ?? "";
      if (duration === 0 && !description) {
        res.status(400).json({ error: "record either a duration or a description" });
        return;
      }
      existing.date = inBody.date;
      existing.durationMin = duration;
      existing.subject = inBody.subject ?? "";
      existing.goalId = inBody.goalId ?? "";
      existing.description = description;
      await store.updateSession(existing);
      res.json(existing);
    })
  );

  app.delete(
    "/api/sessions/:id",
    withAuthJson(async (req, res, u) => {
      let existing: StudySession;
      try {
        existing = await store.sessionById(req.params.id);
      } catch {
        res.status(404).json({ error: "session not found" });
        return;
      }
      if (existing.groupId !== u.groupId) {
        res.status(404).json({ error: "session not found" });
        return;
      }
      if (existing.userId !== u.id) {
        res.status(403).json({ error: "cannot delete a partner's session" });
        return;
      }
      await store.deleteSession(req.params.id);
      res.status(204).end();
    })
  );

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    console.error(err);
    if (res.headersSent) return;
    res.status(500).json({ error: "internal error" });
  });

  return app;
}
