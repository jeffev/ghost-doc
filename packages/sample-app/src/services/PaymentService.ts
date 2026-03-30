import type { TracerInstance } from "@ghost-doc/agent-js";
import type { DatabaseService } from "./DatabaseService.js";

export interface ChargeResult {
  success: boolean;
  transactionId: string | null;
  failureReason?: string;
}

const FAILURE_TOKENS = new Set(["bad-card", "expired-card"]);
let txCounter = 1000;

export class PaymentService {
  readonly validateCard: (cardToken: string) => Promise<boolean>;
  readonly charge: (orderId: string, amount: number, cardToken: string) => Promise<ChargeResult>;
  readonly refund: (transactionId: string, amount: number) => Promise<boolean>;

  constructor(tracer: TracerInstance, private readonly db: DatabaseService) {
    this.validateCard = tracer.wrap(
      async (cardToken: string): Promise<boolean> => {
        // Simulate external card validation network call
        await db.query("payment_methods", { token: cardToken });
        return !FAILURE_TOKENS.has(cardToken);
      },
      "PaymentService.validateCard",
      "Checks whether a card token is accepted before attempting a charge",
    );

    this.charge = tracer.wrap(
      async (orderId: string, amount: number, cardToken: string): Promise<ChargeResult> => {
        if (FAILURE_TOKENS.has(cardToken)) {
          throw new Error(`Payment declined for order ${orderId}: card token invalid`);
        }

        if (Math.random() < 0.1) {
          return { success: false, transactionId: null, failureReason: "Insufficient funds" };
        }

        const txId = `tx-${++txCounter}`;
        await db.execute("transactions", "insert", {
          id: txId,
          orderId,
          amount,
          status: "captured",
          createdAt: new Date().toISOString(),
        });

        return { success: true, transactionId: txId };
      },
      "PaymentService.charge",
      "Captures a payment against an order and records the transaction in the database",
    );

    this.refund = tracer.wrap(
      async (transactionId: string, amount: number): Promise<boolean> => {
        await db.execute("transactions", "update", {
          id: transactionId,
          refundAmount: amount,
          status: "refunded",
        });
        return true;
      },
      "PaymentService.refund",
      "Issues a full or partial refund against a previously captured transaction",
    );
  }
}
