// Pure calculation functions — no DB or HTTP here, same as the Go
// version's internal/grass package. See explanation.md sections 9-11 for
// the full reasoning; this file is a direct, line-for-line port.

import { Goal, StudySession, ProgressMode } from "./models";

export interface Cell {
  date: string;
  actualMin: number;
  targetMin: number;
  ratio: number; // NOT capped
  intensity: number; // min(ratio, 1) — drives color
}

/**
 * actual(date) = sum(duration of sessions on date whose goalId === goal.id)
 * ratio(date)  = actual(date) / goal.targetValue      (0 if target === 0)
 * intensity    = min(ratio, 1)                        (drives cell color)
 */
export function buildCells(goal: Goal, sessions: StudySession[], dates: string[]): Cell[] {
  const sums = new Map<string, number>();
  for (const s of sessions) {
    if (s.goalId !== goal.id) continue;
    sums.set(s.date, (sums.get(s.date) ?? 0) + s.durationMin);
  }

  return dates.map((date) => {
    const actual = sums.get(date) ?? 0;
    const ratio = goal.targetValue > 0 ? actual / goal.targetValue : 0;
    const intensity = Math.min(Math.max(ratio, 0), 1);
    return { date, actualMin: actual, targetMin: goal.targetValue, ratio, intensity };
  });
}

/** "YYYY-MM-DD" strings from start to end inclusive. */
export function dateRange(start: string, end: string): string[] {
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end + "T00:00:00Z");
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || e < s) {
    throw new Error("invalid start/end");
  }
  const out: string[] = [];
  for (let d = new Date(s); d <= e; d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export interface Progress {
  mode: ProgressMode;
  actualMin: number;
  targetMin: number;
  percent: number; // 0-100+, only meaningful if mode === "cumulative"
  hasPercent: boolean; // false => UI must not render a bar/number
}

/**
 * Only "cumulative" goals get a percentage. "none" goals never get a
 * fabricated number (e.g. "Get into MIT"); "rate" goals are represented
 * by Grass, not a lifetime bar. For cumulative goals, actual is summed
 * *recursively down the subtree* (this goal's own sessions plus every
 * descendant goal's actual).
 */
export function computeProgress(goal: Goal, allGoals: Goal[], allSessions: StudySession[]): Progress {
  const base: Progress = { mode: goal.progressMode, actualMin: 0, targetMin: goal.targetValue, percent: 0, hasPercent: false };
  if (goal.progressMode !== "cumulative" || goal.targetValue <= 0) {
    return base;
  }

  const childrenByParent = new Map<string, Goal[]>();
  for (const g of allGoals) {
    const arr = childrenByParent.get(g.parentGoalId) ?? [];
    arr.push(g);
    childrenByParent.set(g.parentGoalId, arr);
  }
  const sessionsByGoal = new Map<string, number>();
  for (const s of allSessions) {
    sessionsByGoal.set(s.goalId, (sessionsByGoal.get(s.goalId) ?? 0) + s.durationMin);
  }

  let total = 0;
  const visited = new Set<string>();
  const walk = (id: string): void => {
    if (visited.has(id)) return; // guard against accidental cycles
    visited.add(id);
    total += sessionsByGoal.get(id) ?? 0;
    for (const child of childrenByParent.get(id) ?? []) {
      walk(child.id);
    }
  };
  walk(goal.id);

  return { mode: goal.progressMode, actualMin: total, targetMin: goal.targetValue, percent: (total / goal.targetValue) * 100, hasPercent: true };
}

export interface TreeNode {
  goal: Goal;
  depth: number;
}

/**
 * Flattens the goal tree into parent-before-children, alphabetical-among
 * -siblings order with depth info, so the view can render indentation
 * with a single loop instead of recursive includes.
 */
export function sortGoalsForTree(goalsList: Goal[]): TreeNode[] {
  const byParent = new Map<string, Goal[]>();
  for (const g of goalsList) {
    const arr = byParent.get(g.parentGoalId) ?? [];
    arr.push(g);
    byParent.set(g.parentGoalId, arr);
  }
  for (const arr of byParent.values()) {
    arr.sort((a, b) => a.title.localeCompare(b.title));
  }

  const out: TreeNode[] = [];
  const walk = (parentId: string, depth: number): void => {
    for (const g of byParent.get(parentId) ?? []) {
      out.push({ goal: g, depth });
      walk(g.id, depth + 1);
    }
  };
  walk("", 0);
  return out;
}
