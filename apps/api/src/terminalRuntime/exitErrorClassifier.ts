// Phase 10.9.7 — classify an exec worker's exit output as non-retryable.
//
// Why: S38 respawn loop. A Codex worker hit its quota wall, emitted "Error:
// 429" and "You've exceeded your plan's usage", and exited non-zero. The
// coordinator saw "non-zero exit → retry" and respawned. The respawn hit
// the same wall, emitted the same error, exited non-zero. Infinite loop,
// burnt Jon's paid Codex Pro quota in ~10 minutes.
//
// The structural fix is to classify the error BEFORE deciding to respawn.
// Errors that will deterministically repeat under retry should mark the
// terminal doNotRespawn permanently, not trigger another spawn.
//
// This module is pure — takes output text, returns a classification. The
// caller (coordinator) decides what to do with the classification.

export type NonRetryableExitErrorClass =
  | "rate_limit" // Transient-looking but never resolves faster than the reset window
  | "quota"      // Plan exhausted, only resets on billing cycle or manual upgrade
  | "auth";      // Token invalid / expired — respawn won't fix it

// Case-insensitive patterns that indicate a non-retryable exit. Keep these
// tight — false positives here would wrongly mark a retryable error as
// terminal. Each pattern is scoped to its class so the classifier can
// report which class matched.
//
// All patterns are OR'd within a class. Class precedence (first match wins)
// is auth > quota > rate_limit — auth errors are the most definitively
// non-retryable (token fix required), quota is plan-level, rate-limit is
// the most nebulous.
const AUTH_PATTERNS: readonly RegExp[] = [
  /\b401\b[\s\S]{0,40}\bunauthor/i,
  /\b403\b[\s\S]{0,40}\bforbidden/i,
  /invalid[\s_-]?api[\s_-]?key/i,
  /authentication\s+failed/i,
  /invalid\s+(auth|token|credentials)/i,
  /expired\s+(token|credentials|session)/i,
  /please\s+(log\s+in|sign\s+in|re-?authenticate)/i,
];

const QUOTA_PATTERNS: readonly RegExp[] = [
  /quota\s+(exceeded|exhausted)/i,
  /out\s+of\s+extra\s+usage/i,
  /hit\s+(your\s+)?usage\s+limit/i,
  /usage\s+limit\s+(exceeded|reached)/i,
  /plan['']?s?\s+usage/i,
  /upgrade\s+to\s+(pro|plus|paid|premium)/i,
  /purchase\s+more\s+credits/i,
  /monthly\s+limit/i,
  /insufficient\s+(quota|credits|balance)/i,
];

const RATE_LIMIT_PATTERNS: readonly RegExp[] = [
  /\b429\b[\s\S]{0,40}(?:too[\s-]?many|rate[\s-]?limit)/i,
  /rate[\s-]?limit(?:ed|ing)?/i,
  /too\s+many\s+requests/i,
  /slow\s+down/i,
];

// Tail-only scan: the error message is almost always near the end of the
// log. Scanning the full log wastes cycles when a long-running turn had
// incidental strings that match.
const TAIL_BYTES = 8192;

const tail = (text: string): string => {
  if (text.length <= TAIL_BYTES) return text;
  return text.slice(text.length - TAIL_BYTES);
};

/**
 * Classify exit output text. Returns the most definitive non-retryable
 * class found, or null if none of the patterns match.
 *
 * Scan order matters — auth is most definitively non-retryable (a token
 * fix is required, respawning will always fail the same way), then quota
 * (plan-level, resets on cycle or upgrade), then rate-limit (transient
 * but short respawn windows don't beat the limit window).
 */
export const classifyExitOutput = (
  output: string | null | undefined,
): NonRetryableExitErrorClass | null => {
  if (!output) return null;
  const haystack = tail(output);

  for (const pattern of AUTH_PATTERNS) {
    if (pattern.test(haystack)) return "auth";
  }
  for (const pattern of QUOTA_PATTERNS) {
    if (pattern.test(haystack)) return "quota";
  }
  for (const pattern of RATE_LIMIT_PATTERNS) {
    if (pattern.test(haystack)) return "rate_limit";
  }
  return null;
};
