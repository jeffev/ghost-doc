import type { TracerInstance } from "@ghost-doc/agent-js";
import type { DatabaseService } from "./DatabaseService.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let auditCounter = 9000;

export class AuditService {
  readonly log: (userId: string, action: string, metadata?: Record<string, unknown>) => Promise<void>;
  readonly getRecentActivity: (userId: string, limit: number) => Promise<unknown[]>;

  constructor(tracer: TracerInstance, private readonly db: DatabaseService) {
    this.log = tracer.wrap(
      async (userId: string, action: string, metadata?: Record<string, unknown>): Promise<void> => {
        await sleep(2 + Math.random() * 3); // 2–5ms
        const entry = {
          id: `audit-${++auditCounter}`,
          userId,
          action,
          metadata: metadata ?? {},
          timestamp: new Date().toISOString(),
        };
        await db.execute("audit_log", "insert", entry);
      },
      "AuditService.log",
      "Appends an immutable audit entry for a user action with optional metadata",
    );

    this.getRecentActivity = tracer.wrap(
      async (userId: string, limit: number): Promise<unknown[]> => {
        const rows = await db.query("audit_log", { userId });
        return rows.slice(-limit);
      },
      "AuditService.getRecentActivity",
      "Returns the most recent audit entries for a user, up to the given limit",
    );
  }
}
