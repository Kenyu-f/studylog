// The persistence layer, now backed by real SQLite.
//
// PORTING NOTE (see explanation.md, "Porting notes: Go -> TypeScript"):
// the Go version couldn't use SQLite because this sandbox had no path to
// the Go module proxy to fetch a driver (Decision D1 in the Go
// explanation.md). That constraint doesn't apply to Node — npm's
// registry was reachable the whole time — and as of Node 22.5+ SQLite is
// actually built into Node itself (`node:sqlite`), so this version uses
// real SQLite with *zero* extra dependencies (not even an npm package
// for the database driver). `node:sqlite` is still flagged
// "experimental" by Node itself; see the note in explanation.md for what
// that means in practice and the fallback if it ever matters to you.
//
// Uses the synchronous `DatabaseSync` API rather than any async
// wrapper — deliberately, to keep the same "one call, one straight-line
// result" style the Go version had with its mutex-guarded methods. This
// app's request volume (two people, a handful of writes a day) makes
// synchronous, blocking SQLite calls a total non-issue.

import { DatabaseSync } from "node:sqlite";
import path from "path";
import fs from "fs";
import { User, Group, Goal, StudySession } from "./models";

export class NotFoundError extends Error {
  constructor() {
    super("not found");
  }
}

export class Store {
  private db: DatabaseSync;

  constructor(dataPath: string) {
    fs.mkdirSync(path.dirname(dataPath), { recursive: true });
    this.db = new DatabaseSync(dataPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        displayName TEXT NOT NULL,
        passwordHash TEXT NOT NULL,
        salt TEXT NOT NULL,
        recoveryCodeHash TEXT NOT NULL,
        recoveryCodeSalt TEXT NOT NULL,
        groupId TEXT NOT NULL,
        createdAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS goals (
        id TEXT PRIMARY KEY,
        groupId TEXT NOT NULL,
        ownerId TEXT NOT NULL,
        shared INTEGER NOT NULL,
        parentGoalId TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL,
        type TEXT NOT NULL,
        progressMode TEXT NOT NULL,
        targetValue REAL NOT NULL,
        targetUnit TEXT NOT NULL,
        targetPeriod TEXT NOT NULL,
        deadline TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        userId TEXT NOT NULL,
        groupId TEXT NOT NULL,
        date TEXT NOT NULL,
        durationMin REAL NOT NULL,
        subject TEXT NOT NULL,
        goalId TEXT NOT NULL,
        description TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tokens (
        token TEXT PRIMARY KEY,
        userId TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_goals_group ON goals(groupId);
      CREATE INDEX IF NOT EXISTS idx_goals_parent ON goals(parentGoalId);
      CREATE INDEX IF NOT EXISTS idx_sessions_group_date ON sessions(groupId, date);
    `);
  }

  // ---- Users ----

  createUser(u: User): void {
    this.db
      .prepare(
        `INSERT INTO users (id, username, displayName, passwordHash, salt, recoveryCodeHash, recoveryCodeSalt, groupId, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(u.id, u.username, u.displayName, u.passwordHash, u.salt, u.recoveryCodeHash, u.recoveryCodeSalt, u.groupId, u.createdAt);
  }

  updateUser(u: User): void {
    const result = this.db
      .prepare(
        `UPDATE users SET username=?, displayName=?, passwordHash=?, salt=?, recoveryCodeHash=?, recoveryCodeSalt=?, groupId=?
         WHERE id=?`
      )
      .run(u.username, u.displayName, u.passwordHash, u.salt, u.recoveryCodeHash, u.recoveryCodeSalt, u.groupId, u.id);
    if (result.changes === 0) throw new NotFoundError();
  }

  userByUsername(username: string): User {
    const row = this.db.prepare(`SELECT * FROM users WHERE username = ?`).get(username);
    if (!row) throw new NotFoundError();
    return row as unknown as User;
  }

  userById(id: string): User {
    const row = this.db.prepare(`SELECT * FROM users WHERE id = ?`).get(id);
    if (!row) throw new NotFoundError();
    return row as unknown as User;
  }

  usersInGroup(groupId: string): User[] {
    return this.db.prepare(`SELECT * FROM users WHERE groupId = ?`).all(groupId) as unknown as User[];
  }

  // ---- Groups ----

  createGroup(g: Group): void {
    this.db.prepare(`INSERT INTO groups (id, name, createdAt) VALUES (?, ?, ?)`).run(g.id, g.name, g.createdAt);
  }

  groupById(id: string): Group {
    const row = this.db.prepare(`SELECT * FROM groups WHERE id = ?`).get(id);
    if (!row) throw new NotFoundError();
    return row as unknown as Group;
  }

  anyGroupExists(): boolean {
    const row = this.db.prepare(`SELECT COUNT(*) as n FROM groups`).get() as { n: number };
    return row.n > 0;
  }

  // ---- Tokens ----

  putToken(token: string, userId: string): void {
    this.db.prepare(`INSERT OR REPLACE INTO tokens (token, userId) VALUES (?, ?)`).run(token, userId);
  }

  userIdForToken(token: string): string | null {
    const row = this.db.prepare(`SELECT userId FROM tokens WHERE token = ?`).get(token) as { userId: string } | undefined;
    return row ? row.userId : null;
  }

  deleteToken(token: string): void {
    this.db.prepare(`DELETE FROM tokens WHERE token = ?`).run(token);
  }

  // ---- Goals ----

  createGoal(g: Goal): void {
    this.db
      .prepare(
        `INSERT INTO goals (id, groupId, ownerId, shared, parentGoalId, title, description, type, progressMode, targetValue, targetUnit, targetPeriod, deadline, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        g.id, g.groupId, g.ownerId, g.shared ? 1 : 0, g.parentGoalId, g.title, g.description, g.type,
        g.progressMode, g.targetValue, g.targetUnit, g.targetPeriod, g.deadline, g.createdAt, g.updatedAt
      );
  }

  updateGoal(g: Goal): void {
    const updatedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE goals SET ownerId=?, shared=?, parentGoalId=?, title=?, description=?, type=?, progressMode=?, targetValue=?, targetUnit=?, targetPeriod=?, deadline=?, updatedAt=?
         WHERE id=?`
      )
      .run(
        g.ownerId, g.shared ? 1 : 0, g.parentGoalId, g.title, g.description, g.type, g.progressMode,
        g.targetValue, g.targetUnit, g.targetPeriod, g.deadline, updatedAt, g.id
      );
    if (result.changes === 0) throw new NotFoundError();
  }

  goalById(id: string): Goal {
    const row = this.db.prepare(`SELECT * FROM goals WHERE id = ?`).get(id);
    if (!row) throw new NotFoundError();
    return rowToGoal(row as any);
  }

  goalsInGroup(groupId: string): Goal[] {
    const rows = this.db.prepare(`SELECT * FROM goals WHERE groupId = ?`).all(groupId);
    return rows.map((r) => rowToGoal(r as any));
  }

  childGoals(parentId: string): Goal[] {
    const rows = this.db.prepare(`SELECT * FROM goals WHERE parentGoalId = ?`).all(parentId);
    return rows.map((r) => rowToGoal(r as any));
  }

  deleteGoal(id: string): void {
    const result = this.db.prepare(`DELETE FROM goals WHERE id = ?`).run(id);
    if (result.changes === 0) throw new NotFoundError();
  }

  // ---- Study Sessions ----

  createSession(s: StudySession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, userId, groupId, date, durationMin, subject, goalId, description, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(s.id, s.userId, s.groupId, s.date, s.durationMin, s.subject, s.goalId, s.description, s.createdAt, s.updatedAt);
  }

  updateSession(s: StudySession): void {
    const updatedAt = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE sessions SET date=?, durationMin=?, subject=?, goalId=?, description=?, updatedAt=?
         WHERE id=?`
      )
      .run(s.date, s.durationMin, s.subject, s.goalId, s.description, updatedAt, s.id);
    if (result.changes === 0) throw new NotFoundError();
  }

  deleteSession(id: string): void {
    const result = this.db.prepare(`DELETE FROM sessions WHERE id = ?`).run(id);
    if (result.changes === 0) throw new NotFoundError();
  }

  sessionById(id: string): StudySession {
    const row = this.db.prepare(`SELECT * FROM sessions WHERE id = ?`).get(id);
    if (!row) throw new NotFoundError();
    return row as unknown as StudySession;
  }

  sessionsInGroup(groupId: string): StudySession[] {
    return this.db.prepare(`SELECT * FROM sessions WHERE groupId = ?`).all(groupId) as unknown as StudySession[];
  }

  sessionsForDate(groupId: string, date: string): StudySession[] {
    return this.db
      .prepare(`SELECT * FROM sessions WHERE groupId = ? AND date = ?`)
      .all(groupId, date) as unknown as StudySession[];
  }
}

// SQLite has no boolean type (stored as 0/1); convert on the way out.
function rowToGoal(row: any): Goal {
  return { ...row, shared: !!row.shared } as Goal;
}
