import type { TracerInstance } from "@ghost-doc/agent-js";
import type { InventoryService, Product } from "./InventoryService.js";
import type { PaymentService } from "./PaymentService.js";
import type { UserService } from "./UserService.js";
import type { AuditService } from "./AuditService.js";
import type { DatabaseService } from "./DatabaseService.js";
import type { CacheService } from "./CacheService.js";

export interface CartItem {
  productId: string;
  qty: number;
}

export interface Order {
  id: string;
  userId: string;
  items: Array<{ product: Product; qty: number; subtotal: number }>;
  total: number;
  status: "pending" | "confirmed" | "failed";
  transactionId: string | null;
  createdAt: number;
}

let orderCounter = 1;

export class OrderService {
  readonly buildOrder: (userId: string, items: CartItem[]) => Promise<Order>;
  readonly processOrder: (order: Order, cardToken: string) => Promise<Order>;
  readonly getOrderSummary: (orderId: string) => Promise<string>;

  constructor(
    tracer: TracerInstance,
    private readonly users: UserService,
    private readonly inventory: InventoryService,
    private readonly payment: PaymentService,
    private readonly audit: AuditService,
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {
    this.buildOrder = tracer.wrap(
      async (userId: string, items: CartItem[]): Promise<Order> => {
        // Validate user exists
        const user = await users.getUser(userId);

        // Validate & price each item
        const lineItems = await Promise.all(
          items.map(async (item) => {
            const product = await inventory.getProduct(item.productId);
            const stock = await inventory.checkStock(item.productId);
            if (stock < item.qty) {
              throw new Error(
                `Insufficient stock for "${product.name}" (requested: ${item.qty}, available: ${stock})`,
              );
            }
            return { product, qty: item.qty, subtotal: product.price * item.qty };
          }),
        );

        const total = lineItems.reduce((sum, l) => sum + l.subtotal, 0);
        const order: Order = {
          id: `order-${orderCounter++}`,
          userId: user.id,
          items: lineItems,
          total,
          status: "pending",
          transactionId: null,
          createdAt: Date.now(),
        };

        await db.execute("orders", "insert", order);
        return order;
      },
      "OrderService.buildOrder",
      "Validates cart items against inventory and assembles a pending order record",
    );

    this.processOrder = tracer.wrap(
      async (order: Order, cardToken: string): Promise<Order> => {
        // Validate card before reserving stock
        const cardValid = await payment.validateCard(cardToken);
        if (!cardValid) {
          await audit.log(order.userId, "order.payment.card_invalid", { orderId: order.id });
          return { ...order, status: "failed" };
        }

        // Reserve stock for all items
        for (const line of order.items) {
          const reserved = await inventory.reserveStock(line.product.id, line.qty);
          if (!reserved) {
            await audit.log(order.userId, "order.stock.insufficient", {
              orderId: order.id,
              productId: line.product.id,
            });
            return { ...order, status: "failed" };
          }
        }

        // Charge payment
        const result = await payment.charge(order.id, order.total, cardToken);

        const processed: Order = {
          ...order,
          status: result.success ? "confirmed" : "failed",
          transactionId: result.transactionId,
        };

        await db.execute("orders", "update", processed);
        await audit.log(order.userId, result.success ? "order.confirmed" : "order.payment.failed", {
          orderId: order.id,
          total: order.total,
        });

        return processed;
      },
      "OrderService.processOrder",
      "Validates the payment card, reserves stock for all items, and charges the customer",
    );

    this.getOrderSummary = tracer.wrap(
      async (orderId: string): Promise<string> => {
        const cacheKey = `order_summary:${orderId}`;
        const cached = await cache.get(cacheKey);
        if (cached !== null) return cached;

        const order = await db.findById("orders", orderId);
        const summary = `Order ${orderId} — ${new Date().toISOString()}`;
        await cache.set(cacheKey, summary, 60_000);
        return summary;
      },
      "OrderService.getOrderSummary",
      "Returns a human-readable summary for a completed order, cached for 60 seconds",
    );
  }

  async place(userId: string, items: CartItem[], cardToken: string): Promise<Order> {
    const order = await this.buildOrder(userId, items);
    const processed = await this.processOrder(order, cardToken);
    await this.getOrderSummary(processed.id);
    return processed;
  }
}
