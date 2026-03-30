import type { TracerInstance } from "@ghost-doc/agent-js";
import type { CacheService } from "./CacheService.js";
import type { DatabaseService } from "./DatabaseService.js";

export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
}

export class InventoryService {
  readonly checkStock: (productId: string) => Promise<number>;
  readonly getProduct: (productId: string) => Promise<Product>;
  readonly reserveStock: (productId: string, qty: number) => Promise<boolean>;

  constructor(
    tracer: TracerInstance,
    private readonly cache: CacheService,
    private readonly db: DatabaseService,
  ) {
    this.checkStock = tracer.wrap(
      async (productId: string): Promise<number> => {
        // Stock is volatile — always read from DB, but cache product metadata
        const cached = await cache.get(`product:${productId}`);
        if (cached !== null) {
          const product = JSON.parse(cached) as Product;
          return product.stock;
        }
        const row = await db.findById("products", productId);
        if (row === null) throw new Error(`Product not found: ${productId}`);
        await cache.set(`product:${productId}`, JSON.stringify(row));
        return (row as Product).stock;
      },
      "InventoryService.checkStock",
      "Returns the available stock quantity for a product, always reading from the database",
    );

    this.getProduct = tracer.wrap(
      async (productId: string): Promise<Product> => {
        const cached = await cache.get(`product:${productId}`);
        if (cached !== null) return JSON.parse(cached) as Product;

        const row = await db.findById("products", productId);
        if (row === null) throw new Error(`Product not found: ${productId}`);

        await cache.set(`product:${productId}`, JSON.stringify(row));
        return row as Product;
      },
      "InventoryService.getProduct",
      "Fetches product details by ID, using the cache to reduce database reads",
    );

    this.reserveStock = tracer.wrap(
      async (productId: string, qty: number): Promise<boolean> => {
        const row = await db.findById("products", productId);
        if (row === null) return false;

        const product = row as Product;
        if (product.stock < qty) return false;

        const updated = { ...product, stock: product.stock - qty };
        await db.execute("products", "update", updated);

        // Invalidate cached stock
        await cache.invalidate(`product:${productId}`);

        return true;
      },
      "InventoryService.reserveStock",
      "Decrements available stock for a product and invalidates the cache entry",
    );
  }
}
