/**
 * Bracket-tag mention parser — port of TinyAGI's balanced-bracket @mention syntax.
 *
 * Source: `~/Projects/tinyagi/packages/teams/src/routing.ts` (Jarvis M0.02 Phase 10.8.2).
 *
 * Syntax:
 *   [@terminal-id: message body]            — route `message body` to terminal-id
 *   [@t1,t2,t3: message body]               — comma-fan-out to multiple terminals
 *   [#team-id: message body]                — broadcast to all members of a team (future)
 *
 * Key properties:
 *   - Depth-aware: handles nested brackets in message bodies, e.g. `[@dev: fix arr[0]]`
 *   - Rejects malformed tags: no colon, brackets inside the id portion, empty id
 *   - Returns spans (start/end indices) so callers can strip tags from the original
 *     text to compute "shared context" (what remains when tags are removed)
 *
 * Why brackets, not bare `@`:
 *   Bare `@mentions` false-match emails, prose ("@risk"), and code strings. TinyAGI's
 *   bracket-delimited form requires explicit opt-in from the sender, which is the
 *   right default for a cross-agent control plane.
 */

export interface BracketTag {
  /** Raw id portion (before the colon). Supports comma-separated lists for fan-out. */
  id: string;
  /** Trimmed message content between the colon and matching closing bracket. */
  message: string;
  /** Index of the opening `[` in the source text. */
  start: number;
  /** Index just past the matching closing `]` in the source text. */
  end: number;
}

/**
 * Extract bracket tags of a given prefix (`@` for mentions, `#` for chat rooms).
 *
 * Handles nested brackets in the MESSAGE portion by counting bracket depth; the
 * ID portion (between `[@` and the first `:`) must be simple (no inner brackets).
 *
 * Returns tags in source order. Does not dedupe.
 */
export function extractBracketTags(text: string, prefix: "@" | "#"): BracketTag[] {
  const results: BracketTag[] = [];
  let i = 0;

  while (i < text.length) {
    if (text[i] === "[" && i + 1 < text.length && text[i + 1] === prefix) {
      const tagStart = i;

      // Find the `:` that separates id from message.
      const colonIdx = text.indexOf(":", i + 2);
      if (colonIdx === -1) {
        i++;
        continue;
      }

      // ID portion must be simple — no nested brackets.
      const idPortion = text.substring(i + 2, colonIdx);
      if (idPortion.includes("[") || idPortion.includes("]")) {
        i++;
        continue;
      }

      const id = idPortion.trim();
      if (!id) {
        i++;
        continue;
      }

      // Find the matching `]` via bracket-depth counting.
      let depth = 1;
      let j = colonIdx + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === "[") depth++;
        else if (text[j] === "]") depth--;
        j++;
      }

      if (depth === 0) {
        const message = text.substring(colonIdx + 1, j - 1).trim();
        results.push({ id, message, start: tagStart, end: j });
      }

      i = j;
    } else {
      i++;
    }
  }

  return results;
}

/**
 * Strip all bracket tags of a given prefix from text. Returns the text with
 * tags removed, trimmed. Used to compute shared context (what's said outside
 * any targeted mention).
 */
export function stripBracketTags(text: string, prefix: "@" | "#"): string {
  const tags = extractBracketTags(text, prefix);
  if (tags.length === 0) return text;

  let result = "";
  let lastEnd = 0;
  for (const tag of tags) {
    result += text.substring(lastEnd, tag.start);
    lastEnd = tag.end;
  }
  result += text.substring(lastEnd);
  return result.trim();
}

export interface ExtractedMention {
  /** Target terminal id (lowercased, trimmed). */
  toTerminalId: string;
  /** Message to deliver. Includes shared context prefix if there was text outside tags. */
  message: string;
}

export interface ExtractMentionsOptions {
  /** Function returning true if the id points to a valid delivery target. */
  isValidTarget: (toTerminalId: string) => boolean;
  /** The sender's terminal id — used to suppress self-mention. */
  fromTerminalId: string;
  /**
   * If true (default), the shared context (text outside all tags) is prepended
   * to each mention so recipients see the full framing, not just the directed
   * segment. Matches TinyAGI's default behavior.
   */
  includeSharedContext?: boolean;
}

/**
 * Extract validated @terminal mentions from a sender's output. Rejects:
 *   - self-mentions (fromTerminalId in the tag id list)
 *   - unknown targets (isValidTarget returns false)
 *   - duplicate targets (first occurrence wins per unique id)
 *
 * Supports comma-separated fan-out: `[@builder,reviewer: msg]` delivers the same
 * message to both.
 */
export function extractTeammateMentions(
  text: string,
  options: ExtractMentionsOptions,
): ExtractedMention[] {
  const { isValidTarget, fromTerminalId, includeSharedContext = true } = options;
  const results: ExtractedMention[] = [];
  const seen = new Set<string>();

  const tags = extractBracketTags(text, "@");
  if (tags.length === 0) return results;

  const sharedContext = includeSharedContext ? stripBracketTags(text, "@") : "";

  for (const tag of tags) {
    const directMessage = tag.message;
    const fullMessage = sharedContext
      ? `${sharedContext}\n\n------\n\nDirected to you:\n${directMessage}`
      : directMessage;

    // Comma-fan-out: [@a,b,c: msg]
    const candidateIds = tag.id
      .toLowerCase()
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    for (const candidateId of candidateIds) {
      if (seen.has(candidateId)) continue;
      if (candidateId === fromTerminalId.toLowerCase()) continue; // suppress self-mention
      if (!isValidTarget(candidateId)) continue;
      results.push({ toTerminalId: candidateId, message: fullMessage });
      seen.add(candidateId);
    }
  }

  return results;
}

/**
 * Convert `[@agent: msg]` tags to readable prose `@from → @agent: msg`. Used for
 * display / transcript rendering when forwarding messages.
 */
export function convertTagsToReadable(text: string, fromTerminalId?: string): string {
  const tags = extractBracketTags(text, "@");
  if (tags.length === 0) return text;

  const prefix = fromTerminalId ? `@${fromTerminalId} → ` : "→ ";
  let result = "";
  let lastEnd = 0;
  for (const tag of tags) {
    result += text.substring(lastEnd, tag.start);
    result += `${prefix}@${tag.id}: ${tag.message}`;
    lastEnd = tag.end;
  }
  result += text.substring(lastEnd);
  return result.trim();
}
