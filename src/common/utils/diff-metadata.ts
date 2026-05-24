/**
 * Build a metadata object containing only the fields that actually changed,
 * shaped as `{ field: { from: <old>, to: <new> } }`.
 *
 * Used by every UPDATE audit entry so a reader can see what changed
 * without comparing snapshots. Operates on raw row objects (typically
 * snake_case from pg); the resulting metadata uses the same field names.
 *
 * Pure function — no dependencies, easy to test in isolation.
 *
 * Example:
 *   diffMetadata(
 *     { name: 'X', desc: 'old' },
 *     { name: 'X', desc: 'new' },
 *     ['name', 'desc'],
 *   )
 *   →  { desc: { from: 'old', to: 'new' } }
 *
 * The generic constraint is `object` rather than `Record<string, unknown>`
 * so the function accepts interface types like `UserRow` directly without
 * the caller having to add an index signature.
 */
export function diffMetadata<T extends object>(
  before: T,
  after: T,
  fields: (keyof T)[],
): Record<string, { from: unknown; to: unknown }> {
  const diff: Record<string, { from: unknown; to: unknown }> = {};
  for (const f of fields) {
    if (before[f] !== after[f]) {
      diff[String(f)] = { from: before[f], to: after[f] };
    }
  }
  return diff;
}
