/**
 * Ghost Doc — Sample App
 *
 * Simulates an e-commerce backend with 8 services and realistic async latencies.
 * Call chains reach 5–6 levels deep:
 *
 *   handleCheckout
 *     └─ OrderService.buildOrder
 *         ├─ UserService.getUser → CacheService.get / DatabaseService.findById → CacheService.set
 *         └─ InventoryService.getProduct → CacheService.get / DatabaseService.findById
 *         └─ InventoryService.checkStock  → CacheService.get / DatabaseService.findById
 *     └─ OrderService.processOrder
 *         ├─ PaymentService.validateCard  → DatabaseService.query
 *         ├─ InventoryService.reserveStock → DatabaseService.findById → DatabaseService.execute → CacheService.invalidate
 *         ├─ PaymentService.charge        → DatabaseService.execute
 *         └─ AuditService.log             → DatabaseService.execute
 *     └─ OrderService.getOrderSummary     → CacheService.get / DatabaseService.findById → CacheService.set
 *     └─ NotificationService.orderConfirmed
 *         ├─ NotificationService.sendEmail → AuditService.log → DatabaseService.execute
 *         └─ NotificationService.sendPush  → AuditService.log → DatabaseService.execute
 */

import { createTracer } from "@ghost-doc/agent-js";
import { CacheService } from "./services/CacheService.js";
import { DatabaseService } from "./services/DatabaseService.js";
import { AuditService } from "./services/AuditService.js";
import { UserService } from "./services/UserService.js";
import { InventoryService } from "./services/InventoryService.js";
import { PaymentService } from "./services/PaymentService.js";
import { OrderService } from "./services/OrderService.js";
import { NotificationService } from "./services/NotificationService.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(msg: string): void {
  const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
  console.log(`[${ts}] ${msg}`);
}

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
}

// ---------------------------------------------------------------------------
// Tracer + service wiring
// ---------------------------------------------------------------------------

const tracer = createTracer({
  agentId: "sample-ecommerce",
  hubUrl: "ws://127.0.0.1:3001/agent",
  sanitize: ["password", "cardToken", "token", "secret"],
});

const cache    = new CacheService(tracer);
const db       = new DatabaseService(tracer);
const audit    = new AuditService(tracer, db);
const users    = new UserService(tracer, cache, db, audit);
const inventory = new InventoryService(tracer, cache, db);
const payment  = new PaymentService(tracer, db);
const orders   = new OrderService(tracer, users, inventory, payment, audit, db, cache);
const notify   = new NotificationService(tracer, audit);

// ---------------------------------------------------------------------------
// Top-level request handlers (traced — these become the root spans)
// ---------------------------------------------------------------------------

const USER_IDS    = ["u1", "u2", "u3"];
const PRODUCT_IDS = ["p1", "p2", "p4", "p5"];
const VALID_CARD  = "card-tok-valid";
const BAD_CARD    = "bad-card";

const handleCheckout = tracer.wrap(
  async (userId: string, productIds: string[], cardToken: string): Promise<void> => {
    const items = productIds.map((id) => ({ productId: id, qty: 1 }));
    const order = await orders.place(userId, items, cardToken);

    if (order.status === "confirmed") {
      await notify.orderConfirmed(userId, order.id);
      log(`  ✓ ${order.id} confirmed  ($${order.total.toFixed(2)})  tx:${order.transactionId ?? "-"}`);
    } else {
      await notify.orderFailed(userId, order.id);
      log(`  ✗ ${order.id} failed`);
    }
  },
  "handleCheckout",
  "Orchestrates the full checkout flow: build order, process payment, and send confirmation",
);

const handleLogin = tracer.wrap(
  async (email: string): Promise<void> => {
    const user = await users.authenticate(email, "s3cr3t");
    if (user !== null) {
      await users.getUserPreferences(user.id);
      log(`  ✓ ${user.name} authenticated`);
    } else {
      log(`  ✗ login failed for ${email}`);
    }
  },
  "handleLogin",
  "Authenticates a user by email and loads their preferences on success",
);

const handleProfileLoad = tracer.wrap(
  async (userId: string): Promise<void> => {
    const user = await users.getUser(userId);
    const prefs = await users.getUserPreferences(userId);
    const activity = await audit.getRecentActivity(userId, 5);
    log(`  ✓ profile loaded for ${user.name} (${Object.keys(prefs).length} prefs, ${activity.length} events)`);
  },
  "handleProfileLoad",
  "Loads a user's full profile: account data, preferences, and recent audit activity",
);

const handleProductSearch = tracer.wrap(
  async (productIds: string[]): Promise<void> => {
    const results = await Promise.all(
      productIds.map(async (id) => {
        const stock = await inventory.checkStock(id);
        const product = await inventory.getProduct(id);
        return { ...product, stock };
      }),
    );
    const inStock = results.filter((p) => p.stock > 0);
    log(`  ✓ search: ${inStock.length}/${results.length} in stock`);
  },
  "handleProductSearch",
  "Fetches product details and stock levels for a list of product IDs in parallel",
);

const handleRefund = tracer.wrap(
  async (userId: string, transactionId: string, amount: number): Promise<void> => {
    const ok = await payment.refund(transactionId, amount);
    if (ok) {
      await notify.securityAlert(userId, "refund.processed");
      await audit.log(userId, "order.refunded", { transactionId, amount });
      log(`  ✓ refund processed: ${transactionId}`);
    }
  },
  "handleRefund",
  "Processes a payment refund and notifies the user with a security alert",
);

// ---------------------------------------------------------------------------
// Scenario definitions
// ---------------------------------------------------------------------------

async function scenarioHappyPath(): Promise<void> {
  const userId = randomItem(USER_IDS);
  const productId = randomItem(PRODUCT_IDS);
  log(`[happy-path] user=${userId} product=${productId}`);
  await handleCheckout(userId, [productId], VALID_CARD);
}

async function scenarioMultiItemCheckout(): Promise<void> {
  const userId = randomItem(["u1", "u3"]); // premium users
  const productIds = [randomItem(PRODUCT_IDS), randomItem(PRODUCT_IDS)].filter(
    (v, i, a) => a.indexOf(v) === i,
  );
  log(`[multi-item] user=${userId} products=${productIds.join(",")}`);
  await handleCheckout(userId, productIds, VALID_CARD);
}

async function scenarioPaymentFailure(): Promise<void> {
  const userId = randomItem(USER_IDS);
  log(`[payment-fail] user=${userId} bad-card`);
  try {
    await handleCheckout(userId, ["p1"], BAD_CARD);
  } catch (err) {
    log(`  ✗ caught: ${(err as Error).message}`);
  }
}

async function scenarioOutOfStock(): Promise<void> {
  const userId = randomItem(USER_IDS);
  log(`[out-of-stock] user=${userId} product=p3 (stock=0)`);
  try {
    await handleCheckout(userId, ["p3"], VALID_CARD);
  } catch (err) {
    log(`  ✗ caught: ${(err as Error).message}`);
    await notify.orderFailed(userId, "out-of-stock");
  }
}

async function scenarioLogin(): Promise<void> {
  const email = randomItem([
    "alice@example.com",
    "bob@example.com",
    "carol@example.com",
    "hacker@evil.com", // will fail
  ]);
  log(`[login] ${email}`);
  await handleLogin(email);
}

async function scenarioProfileLoad(): Promise<void> {
  const userId = randomItem(USER_IDS);
  log(`[profile] user=${userId}`);
  await handleProfileLoad(userId);
}

async function scenarioProductSearch(): Promise<void> {
  const subset = PRODUCT_IDS.slice(0, 2 + Math.floor(Math.random() * 3));
  log(`[search] products=${subset.join(",")}`);
  await handleProductSearch(subset);
}

async function scenarioRefund(): Promise<void> {
  const userId = randomItem(USER_IDS);
  log(`[refund] user=${userId}`);
  await handleRefund(userId, "tx-1001", 89.99);
}

// ---------------------------------------------------------------------------
// Weighted scenario pool
// ---------------------------------------------------------------------------

const SCENARIOS: Array<{ weight: number; name: string; fn: () => Promise<void> }> = [
  { weight: 6, name: "happy-path",        fn: scenarioHappyPath },
  { weight: 3, name: "multi-item",        fn: scenarioMultiItemCheckout },
  { weight: 2, name: "payment-failure",   fn: scenarioPaymentFailure },
  { weight: 1, name: "out-of-stock",      fn: scenarioOutOfStock },
  { weight: 5, name: "login",             fn: scenarioLogin },
  { weight: 4, name: "profile-load",      fn: scenarioProfileLoad },
  { weight: 4, name: "product-search",    fn: scenarioProductSearch },
  { weight: 1, name: "refund",            fn: scenarioRefund },
];

const POOL: Array<{ name: string; fn: () => Promise<void> }> = [];
for (const s of SCENARIOS) {
  for (let i = 0; i < s.weight; i++) POOL.push({ name: s.name, fn: s.fn });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const TOTAL_ROUNDS = 30;
  const CONCURRENCY  = 3; // run N scenarios in parallel per batch

  console.log("┌──────────────────────────────────────────────────────┐");
  console.log("│  Ghost Doc — Sample App  (e-commerce backend)        │");
  console.log("│  Sending traces to ws://127.0.0.1:3001/agent         │");
  console.log("│                                                      │");
  console.log("│  Services: Cache · Database · Users · Inventory      │");
  console.log("│            Payment · Orders · Notifications · Audit  │");
  console.log("└──────────────────────────────────────────────────────┘");
  console.log(`\nRunning ${TOTAL_ROUNDS} rounds (${CONCURRENCY} concurrent)…\n`);

  await sleep(400); // let WS transport connect

  for (let round = 1; round <= TOTAL_ROUNDS; round += CONCURRENCY) {
    const batch = Array.from({ length: Math.min(CONCURRENCY, TOTAL_ROUNDS - round + 1) }, () =>
      randomItem(POOL),
    );

    console.log(`\n── Round ${round}–${Math.min(round + CONCURRENCY - 1, TOTAL_ROUNDS)} ──`);

    await Promise.all(
      batch.map(async (scenario) => {
        try {
          await scenario.fn();
        } catch (err) {
          log(`  Unhandled (${scenario.name}): ${(err as Error).message}`);
        }
      }),
    );
  }

  console.log("\n✓ Simulation complete.\n");
  console.log("Run these commands to generate documentation:\n");
  console.log("  node packages/hub/dist/cli.js export --format markdown --output FLOW.md --project SampleApp");
  console.log("  node packages/hub/dist/cli.js snapshot");

  await sleep(800); // flush remaining traces
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
