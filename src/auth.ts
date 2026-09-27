// Minimal, dependency-free auth helpers — Node's built-in `crypto`
// module only (no bcrypt/argon2 package). Same tradeoff as the Go
// version's internal/authutil: fine for a private two-person tool, not
// for a public-facing deployment. See explanation.md section 18.

import { randomBytes, createHash, timingSafeEqual } from "crypto";

const STRETCH_ITERATIONS = 100_000;

export function newSalt(): string {
  return randomBytes(16).toString("hex");
}

export function hashPassword(password: string, salt: string): string {
  let sum = createHash("sha256").update(`${salt}:${password}`).digest();
  for (let i = 0; i < STRETCH_ITERATIONS; i++) {
    sum = createHash("sha256").update(sum).digest();
  }
  return sum.toString("hex");
}

export function verifyPassword(password: string, salt: string, wantHash: string): boolean {
  const got = Buffer.from(hashPassword(password, salt), "hex");
  const want = Buffer.from(wantHash, "hex");
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("hex");
}

// Excludes visually-ambiguous characters (0/O, 1/I/L) since a person
// copies this down by hand as a backup.
const RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Returns a human-copyable code like "XKQP-7GH2-MNB4". */
export function newRecoveryCode(): string {
  const groups = 3;
  const groupLen = 4;
  const raw = randomBytes(groups * groupLen);
  const parts: string[] = [];
  for (let g = 0; g < groups; g++) {
    let part = "";
    for (let i = 0; i < groupLen; i++) {
      const byte = raw[g * groupLen + i];
      part += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    }
    parts.push(part);
  }
  return parts.join("-");
}
