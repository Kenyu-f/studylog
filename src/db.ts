// The persistence layer — Vercel edition, backed by Neon serverless
// Postgres instead of node:sqlite.
//
// PORTING NOTE (see explanation.md, "Adapting for Vercel"): the original
// TypeScript port (for Deplexo) used Node's built-in node:sqlite, backed
// by a local file. That doesn't work on Vercel — Functions have no
// writable persistent disk (see explanation.md for the full reasoning),
// so this version replaces the entire storage layer with Neon's
// `@neondatabase/serverless` driver, which talks to Postgres over HTTP
// rather than a long-lived TCP connection. That distinction matters
// specifically *because* this is serverless: a traditional TCP
// connection pool (e.g. plain `pg`) tends to exhaust a database's
// connection limit under serverless traffic, because every cold-started
// function instance opens its own pool. An HTTP-based driver has no such
// connection to hold open, so it has no such problem.
//
// Every method is now `async` (Promise-based) — the one structural
// change every caller in src/app.ts had to follow through on, since the
// old SQLite version was fully synchronous.

import { neon } from "@neondatabase/serverless";
import { User, Group, Goal, StudySession } from "./models";

export class NotFoundError extends Error {
  constructor() {
    super("not found");
  }
}

/**
 * The one shape of "run a SQL query" this file depends on: a tagged
 * template that returns rows. Neon's `neon()` function satisfies it in
 * production; tests pass in an adapter over an in-process Postgres
 * (PGlite) so the exact same SQL below can be verified without network
 * access to a real Neon database.
 */
export type SqlFn = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>;

export class Store {
  private sql: SqlFn;

  /** @param databaseUrlOrSql a Neon connection string, or a SqlFn (tests). */
  constructor(databaseUrlOrSql: string | SqlFn) {
    this.sql =
      typeof databaseUrlOrSql === "string"
        ? (neon(databaseUrlOrSql) as unknown as SqlFn)
        : databaseUrlOrSql;
  }

  async init(): Promise<void> {
    await this.migrate();
  }

  private async migrate(): Promise<void> {
    const sql = this.sql;
    await sql`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        "createdAt" TEXT NOT NULL
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        "displayName" TEXT NOT NULL,
        "passwordHash" TEXT NOT NULL,
        salt TEXT NOT NULL,
        "recoveryCodeHash" TEXT NOT NULL,
        "recoveryCodeSalt" TEXT NOT NULL,
        "groupId" TEXT NOT NULL,
        "createdAt" TEXT NOT NULL
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        "groupId" TEXT NOT NULL,
        "ownerId" TEXT NOT NULL,
        shared BOOLEAN NOT NULL,
        "parentGoalId" TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        "progressMode" TEXT NOT NULL,
        "targetValue" DOUBLE PRECISION NOT NULL,
        "targetUnit" TEXT NOT NULL,
        "targetPeriod" TEXT NOT NULL,
        deadline TEXT,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL,
        "groupId" TEXT NOT NULL,
        date TEXT NOT NULL,
        "durationMin" DOUBLE PRECISION NOT NULL,
        subject TEXT NOT NULL,
        "goalId" TEXT NOT NULL,
        description TEXT NOT NULL,
        "createdAt" TEXT NOT NULL,
        "updatedAt" TEXT NOT NULL
      )
    `;
    await sql`
      CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        "userId" TEXT NOT NULL
      )
    `;
    await sql`CREATE INDEX IF NOT EXISTS idx_goals_group ON goals("groupId")`;
    await sql`CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals("parentGoalId")`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sessions_group_date ON sessions("groupId", date)`;
  }

  // ---- Users ----

  async createUser(u: User): Promise<void> {
    await this.sql`
      INSERT INTO users (id, username, "displayName", "passwordHash", salt, "recoveryCodeHash", "recoveryCodeSalt", "groupId", "createdAt")
      VALUES (${u.id}, ${u.username}, ${u.displayName}, ${u.passwordHash}, ${u.salt}, ${u.recoveryCodeHash}, ${u.recoveryCodeSalt}, ${u.groupId}, ${u.createdAt})
    `;
  }

  async updateUser(u: User): Promise<void> {
    const rows = await this.sql`
      UPDATE users SET username=${u.username}, "displayName"=${u.displayName}, "passwordHash"=${u.passwordHash},
        salt=${u.salt}, "recoveryCodeHash"=${u.recoveryCodeHash}, "recoveryCodeSalt"=${u.recoveryCodeSalt}, "groupId"=${u.groupId}
      WHERE id=${u.id}
      RETURNING id
    `;
    if (rows.length === 0) throw new NotFoundError();
  }

  async userByUsername(username: string): Promise<User> {
    const rows = await this.sql`SELECT * FROM users WHERE username = ${username}`;
    if (rows.length === 0) throw new NotFoundError();
    return rows[0] as unknown as User;
  }

  async userById(id: string): Promise<User> {
    const rows = await this.sql`SELECT * FROM users WHERE id = ${id}`;
    if (rows.length === 0) throw new NotFoundError();
    return rows[0] as unknown as User;
  }

  async usersInGroup(groupId: string): Promise<User[]> {
    const rows = await this.sql`SELECT * FROM users WHERE "groupId" = ${groupId}`;
    return rows as unknown as User[];
  }

  // ---- Groups ----

  async createGroup(g: Group): Promise<void> {
    await this.sql`INSERT INTO groups (id, name, "createdAt") VALUES (${g.id}, ${g.name}, ${g.createdAt})`;
  }

  async groupById(id: string): Promise<Group> {
    const rows = await this.sql`SELECT * FROM groups WHERE id = ${id}`;
    if (rows.length === 0) throw new NotFoundError();
    return rows[0] as unknown as Group;
  }

  async anyGroupExists(): Promise<boolean> {
    const rows = await this.sql`SELECT COUNT(*)::int as n FROM groups`;
    return (rows[0] as { n: number }).n > 0;
  }

  // ---- Tokens ----

  async putToken(token: string, userId: string): Promise<void> {
    await this.sql`
      INSERT INTO tokens (token, "userId") VALUES (${token}, ${userId})
      ON CONFLICT (token) DO UPDATE SET "userId" = EXCLUDED."userId"
    `;
  }

  async userIdForToken(token: string): Promise<string | null> {
    const rows = await this.sql`SELECT "userId" FROM tokens WHERE token = ${token}`;
    return rows.length > 0 ? (rows[0] as { userId: string }).userId : null;
  }

  async deleteToken(token: string): Promise<void> {
    await this.sql`DELETE FROM tokens WHERE token = ${token}`;
  }

  // ---- Goals ----

  async createGoal(g: Goal): Promise<void> {
    await this.sql`
      INSERT INTO goals (id, "groupId", "ownerId", shared, "parentGoalId", title, description, type, "progressMode", "targetValue", "targetUnit", "targetPeriod", deadline, "createdAt", "updatedAt")
      VALUES (${g.id}, ${g.groupId}, ${g.ownerId}, ${g.shared}, ${g.parentGoalId}, ${g.title}, ${g.description}, ${g.type}, ${g.progressMode}, ${g.targetValue}, ${g.targetUnit}, ${g.targetPeriod}, ${g.deadline}, ${g.createdAt}, ${g.updatedAt})
    `;
  }

  async updateGoal(g: Goal): Promise<void> {
    const updatedAt = new Date().toISOString();
    const rows = await this.sql`
      UPDATE goals SET "ownerId"=${g.ownerId}, shared=${g.shared}, "parentGoalId"=${g.parentGoalId}, title=${g.title},
        description=${g.description}, type=${g.type}, "progressMode"=${g.progressMode}, "targetValue"=${g.targetValue},
        "targetUnit"=${g.targetUnit}, "targetPeriod"=${g.targetPeriod}, deadline=${g.deadline}, "updatedAt"=${updatedAt}
      WHERE id=${g.id}
      RETURNING id
    `;
    if (rows.length === 0) throw new NotFoundError();
  }

  async goalById(id: string): Promise<Goal> {
    const rows = await this.sql`SELECT * FROM goals WHERE id = ${id}`;
    if (rows.length === 0) throw new NotFoundError();
    return rows[0] as unknown as Goal;
  }

  async goalsInGroup(groupId: string): Promise<Goal[]> {
    const rows = await this.sql`SELECT * FROM goals WHERE "groupId" = ${groupId}`;
    return rows as unknown as Goal[];
  }

  async childGoals(parentId: string): Promise<Goal[]> {
    const rows = await this.sql`SELECT * FROM goals WHERE "parentGoalId" = ${parentId}`;
    return rows as unknown as Goal[];
  }

  async deleteGoal(id: string): Promise<void> {
    const rows = await this.sql`DELETE FROM goals WHERE id = ${id} RETURNING id`;
    if (rows.length === 0) throw new NotFoundError();
  }

  // ---- Study Sessions ----

  async createSession(s: StudySession): Promise<void> {
    await this.sql`
      INSERT INTO sessions (id, "userId", "groupId", date, "durationMin", subject, "goalId", description, "createdAt", "updatedAt")
      VALUES (${s.id}, ${s.userId}, ${s.groupId}, ${s.date}, ${s.durationMin}, ${s.subject}, ${s.goalId}, ${s.description}, ${s.createdAt}, ${s.updatedAt})
    `;
  }

  async updateSession(s: StudySession): Promise<void> {
    const updatedAt = new Date().toISOString();
    const rows = await this.sql`
      UPDATE sessions SET date=${s.date}, "durationMin"=${s.durationMin}, subject=${s.subject}, "goalId"=${s.goalId},
        description=${s.description}, "updatedAt"=${updatedAt}
      WHERE id=${s.id}
      RETURNING id
    `;
    if (rows.length === 0) throw new NotFoundError();
  }

  async deleteSession(id: string): Promise<void> {
    const rows = await this.sql`DELETE FROM sessions WHERE id = ${id} RETURNING id`;
    if (rows.length === 0) throw new NotFoundError();
  }

  async sessionById(id: string): Promise<StudySession> {
    const rows = await this.sql`SELECT * FROM sessions WHERE id = ${id}`;
    if (rows.length === 0) throw new NotFoundError();
    return rows[0] as unknown as StudySession;
  }

  async sessionsInGroup(groupId: string): Promise<StudySession[]> {
    const rows = await this.sql`SELECT * FROM sessions WHERE "groupId" = ${groupId}`;
    return rows as unknown as StudySession[];
  }

  async sessionsForDate(groupId: string, date: string): Promise<StudySession[]> {
    const rows = await this.sql`SELECT * FROM sessions WHERE "groupId" = ${groupId} AND date = ${date}`;
    return rows as unknown as StudySession[];
  }
}
