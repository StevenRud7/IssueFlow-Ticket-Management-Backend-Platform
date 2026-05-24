/**
 * Extracts @mentions from comment content.
 *
 * The regex (/@([a-zA-Z0-9_]+)/g) matches `@` followed by 1+ alphanumeric
 * or underscore characters. This intentionally matches the username
 * character class enforced by CreateUserDto in Phase 2 — usernames can
 * only contain those characters, so the parser will catch every legal
 * mention while ignoring things like email addresses ("ping @ jdoe" or
 * "see jdoe@example.com" stay un-matched).
 *
 * Returned usernames are:
 *   - lower-cased (so "@JDoe" and "@jdoe" resolve to the same user — the
 *     case-insensitivity required by §3.6)
 *   - deduplicated (a single comment can mention the same user multiple
 *     times without producing duplicate mention rows)
 *
 * Pure function, no DB access — the resolver in CommentsService converts
 * usernames to user ids.
 */
export function parseMentions(content: string): string[] {
  if (!content) return [];
  const re = /@([a-zA-Z0-9_]+)/g;
  const seen = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    seen.add(match[1].toLowerCase());
  }
  return Array.from(seen);
}
