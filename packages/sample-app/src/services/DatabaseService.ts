import type { TracerInstance } from "@ghost-doc/agent-js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function jitter(base: number, spread: number): number {
  return base + Math.random() * spread;
}

/** Simulated row store keyed by table → id → row */
const TABLES: Record<string, Record<string, unknown>> = {
  users: {
    u1: { id: "u1", name: "Alice Chen",  email: "alice@example.com", tier: "premium", createdAt: "2024-01-15" },
    u2: { id: "u2", name: "Bob Smith",   email: "bob@example.com",   tier: "free",    createdAt: "2024-03-02" },
    u3: { id: "u3", name: "Carol Davis", email: "carol@example.com", tier: "premium", createdAt: "2024-05-20" },
  },
  products: {
    p1: { id: "p1", name: "Wireless Headphones", price: 89.99,  stock: 42 },
    p2: { id: "p2", name: "Mechanical Keyboard",  price: 129.99, stock: 15 },
    p3: { id: "p3", name: "USB-C Hub",            price: 49.99,  stock: 0  },
    p4: { id: "p4", name: "Webcam HD",            price: 69.99,  stock: 28 },
    p5: { id: "p5", name: "Desk Lamp",            price: 39.99,  stock: 7  },
  },
  orders: {},
  audit_log: {},
};

export class DatabaseService {
  readonly findById: (table: string, id: string) => Promise<unknown>;
  readonly query: (table: string, filter: Record<string, unknown>) => Promise<unknown[]>;
  readonly execute: (table: string, operation: string, payload: unknown) => Promise<{ affected: number }>;
  readonly count: (table: string) => Promise<number>;

  constructor(tracer: TracerInstance) {
    this.findById = tracer.wrap(
      async (table: string, id: string): Promise<unknown> => {
        await sleep(jitter(12, 18)); // 12–30ms — simulated indexed read
        const row = (TABLES[table] ?? {})[id];
        return row ?? null;
      },
      "DatabaseService.findById",
      "Performs a primary-key lookup on the given table",
    );

    this.query = tracer.wrap(
      async (table: string, filter: Record<string, unknown>): Promise<unknown[]> => {
        await sleep(jitter(18, 22)); // 18–40ms — simulated full-scan query
        const rows = Object.values(TABLES[table] ?? {});
        return rows.filter((row) => {
          const r = row as Record<string, unknown>;
          return Object.entries(filter).every(([k, v]) => r[k] === v);
        });
      },
      "DatabaseService.query",
      "Runs a full table scan with an equality filter on the given table",
    );

    this.execute = tracer.wrap(
      async (table: string, operation: string, payload: unknown): Promise<{ affected: number }> => {
        await sleep(jitter(20, 30)); // 20–50ms — simulated write
        if (operation === "insert" || operation === "update") {
          const p = payload as Record<string, unknown>;
          const id = p["id"] as string | undefined;
          if (id !== undefined) {
            if (!TABLES[table]) TABLES[table] = {};
            TABLES[table][id] = payload;
          }
        }
        return { affected: 1 };
      },
      "DatabaseService.execute",
      "Executes an insert or update operation and persists the payload to the table",
    );

    this.count = tracer.wrap(
      async (table: string): Promise<number> => {
        await sleep(jitter(5, 8)); // 5–13ms — simulated COUNT(*)
        return Object.keys(TABLES[table] ?? {}).length;
      },
      "DatabaseService.count",
      "Returns the total number of rows in the given table",
    );
  }
}
