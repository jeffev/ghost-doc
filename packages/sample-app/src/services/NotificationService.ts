import type { TracerInstance } from "@ghost-doc/agent-js";
import type { AuditService } from "./AuditService.js";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

let msgCounter = 5000;

export class NotificationService {
  readonly sendEmail: (userId: string, subject: string, body: string) => Promise<void>;
  readonly sendPush: (userId: string, title: string) => Promise<void>;
  readonly sendSms: (userId: string, message: string) => Promise<void>;

  constructor(tracer: TracerInstance, private readonly audit: AuditService) {
    this.sendEmail = tracer.wrap(
      async (userId: string, subject: string, _body: string): Promise<void> => {
        await sleep(8 + Math.random() * 12); // 8–20ms — SMTP handshake simulation
        const msgId = `email-${++msgCounter}`;
        await audit.log(userId, "notification.email.sent", { subject, msgId });
      },
      "NotificationService.sendEmail",
      "Sends a transactional email to the user via the SMTP gateway",
    );

    this.sendPush = tracer.wrap(
      async (userId: string, title: string): Promise<void> => {
        await sleep(5 + Math.random() * 8); // 5–13ms — push gateway
        const delivered = Math.random() > 0.05;
        const msgId = delivered ? `push-${++msgCounter}` : null;
        await audit.log(userId, delivered ? "notification.push.delivered" : "notification.push.failed", {
          title,
          msgId,
        });
      },
      "NotificationService.sendPush",
      "Delivers a push notification to the user's registered devices via the push gateway",
    );

    this.sendSms = tracer.wrap(
      async (userId: string, message: string): Promise<void> => {
        await sleep(15 + Math.random() * 20); // 15–35ms — SMS provider
        await audit.log(userId, "notification.sms.sent", { messageLength: message.length });
      },
      "NotificationService.sendSms",
      "Sends an SMS message to the user via the SMS provider",
    );
  }

  async orderConfirmed(userId: string, orderId: string): Promise<void> {
    await Promise.all([
      this.sendEmail(userId, `Order ${orderId} confirmed`, `Your order has been confirmed.`),
      this.sendPush(userId, `Order ${orderId} confirmed`),
    ]);
  }

  async orderFailed(userId: string, orderId: string): Promise<void> {
    await this.sendEmail(userId, `Order ${orderId} failed`, `We could not process your order.`);
  }

  async securityAlert(userId: string, action: string): Promise<void> {
    await Promise.all([
      this.sendEmail(userId, `Security alert: ${action}`, `Unusual activity detected.`),
      this.sendSms(userId, `Security alert: ${action}`),
    ]);
  }
}
