import type { TracerInstance } from "@ghost-doc/agent-js";
import type { CacheService } from "./CacheService.js";
import type { DatabaseService } from "./DatabaseService.js";
import type { AuditService } from "./AuditService.js";

export interface User {
  id: string;
  name: string;
  email: string;
  tier: "free" | "premium";
}

export class UserService {
  readonly getUser: (id: string) => Promise<User>;
  readonly authenticate: (email: string, password: string) => Promise<User | null>;
  readonly getUserPreferences: (userId: string) => Promise<Record<string, string>>;

  constructor(
    tracer: TracerInstance,
    private readonly cache: CacheService,
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
  ) {
    this.getUser = tracer.wrap(
      async (id: string): Promise<User> => {
        // 1. Cache check
        const cached = await cache.get(`user:${id}`);
        if (cached !== null) return JSON.parse(cached) as User;

        // 2. DB fallback
        const row = await db.findById("users", id);
        if (row === null) throw new Error(`User not found: ${id}`);

        // 3. Populate cache
        await cache.set(`user:${id}`, JSON.stringify(row));
        return row as User;
      },
      "UserService.getUser",
      "Fetches a user by ID, checking the cache first and falling back to the database",
    );

    this.authenticate = tracer.wrap(
      async (email: string, _password: string): Promise<User | null> => {
        // Full table query (no email index in this simulation)
        const rows = await db.query("users", { email });
        const user = (rows[0] ?? null) as User | null;

        if (user !== null) {
          await audit.log(user.id, "auth.login.success", { email });
          await cache.set(`user:${user.id}`, JSON.stringify(user));
        } else {
          await audit.log("anonymous", "auth.login.failed", { email });
        }

        return user;
      },
      "UserService.authenticate",
      "Validates user credentials and writes the resolved user to cache on success",
    );

    this.getUserPreferences = tracer.wrap(
      async (userId: string): Promise<Record<string, string>> => {
        const cacheKey = `prefs:${userId}`;
        const cached = await cache.get(cacheKey);
        if (cached !== null) return JSON.parse(cached) as Record<string, string>;

        const user = await db.findById("users", userId) as User | null;
        const prefs: Record<string, string> =
          user?.tier === "premium"
            ? { theme: "dark", currency: "USD", notifications: "all", layout: "compact" }
            : { theme: "light", currency: "USD", notifications: "essential", layout: "default" };

        await cache.set(cacheKey, JSON.stringify(prefs), 300_000);
        return prefs;
      },
      "UserService.getUserPreferences",
      "Returns UI and notification preferences based on the user's subscription tier",
    );
  }
}
