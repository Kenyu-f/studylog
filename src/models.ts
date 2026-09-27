// Plain data shapes for StudyLog. Mirrors the Go version's
// internal/models/models.go 1:1 — see explanation.md "Porting notes:
// Go -> TypeScript" for how each concept maps.

export type GoalType = "long-term" | "medium-term" | "short-term";

export type ProgressMode = "none" | "rate" | "cumulative";

export interface User {
  id: string;
  username: string;
  displayName: string;
  passwordHash: string;
  salt: string;
  recoveryCodeHash: string;
  recoveryCodeSalt: string;
  groupId: string;
  createdAt: string; // ISO 8601
}

export interface Group {
  id: string;
  name: string;
  createdAt: string;
}

export interface Goal {
  id: string;
  groupId: string;
  ownerId: string; // "" if shared
  shared: boolean;
  parentGoalId: string; // "" for root goals
  title: string;
  description: string;
  type: GoalType;
  progressMode: ProgressMode;
  targetValue: number; // 0 means "no numeric target"
  targetUnit: string; // e.g. "min"
  targetPeriod: string; // "day" | "week" | "total"
  deadline: string | null; // "YYYY-MM-DD" or null
  createdAt: string;
  updatedAt: string;
}

export interface StudySession {
  id: string;
  userId: string;
  groupId: string;
  date: string; // "YYYY-MM-DD"
  durationMin: number;
  subject: string;
  goalId: string; // "" allowed: unlinked session
  description: string;
  createdAt: string;
  updatedAt: string;
}
