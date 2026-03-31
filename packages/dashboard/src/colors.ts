/**
 * Central color palette for Ghost Doc dashboard.
 *
 * Agent colors are assigned deterministically via a fast string hash so that
 * the same agent always receives the same color regardless of arrival order.
 */

export const AGENT_PALETTE: readonly string[] = [
  "#6366f1", // indigo
  "#22c55e", // green
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#ec4899", // pink
  "#a855f7", // purple
  "#14b8a6", // teal
  "#f97316", // orange
  "#2563eb", // blue
  "#059669", // emerald
  "#d97706", // yellow
  "#0891b2", // sky
];

/**
 * Returns a stable color for an agent ID using a djb2-style hash.
 * The same agentId always maps to the same color.
 */
export function agentColor(agentId: string): string {
  let hash = 5381;
  for (let i = 0; i < agentId.length; i++) {
    hash = ((hash << 5) + hash + agentId.charCodeAt(i)) & 0xffff;
  }
  return AGENT_PALETTE[Math.abs(hash) % AGENT_PALETTE.length] ?? AGENT_PALETTE[0]!;
}
