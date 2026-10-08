import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { PaymentService } from "./payment.service";
import { WebhookInboxDatabase } from "./webhook-inbox.database";

@Injectable()
export class WebhookInboxProcessor {
  private readonly logger = new Logger(WebhookInboxProcessor.name);
  private running = false;
  private missingDatabaseLogged = false;

  constructor(
    private readonly inbox: WebhookInboxDatabase,
    private readonly payments: PaymentService,
    private readonly config: ConfigService,
  ) {}

  @Interval(3000)
  async processNext(): Promise<void> {
    if (!this.config.get<string>("WEBHOOK_DATABASE_URL")) {
      if (!this.missingDatabaseLogged) {
        this.logger.warn(
          "Webhook worker desativado: WEBHOOK_DATABASE_URL não está configurada",
        );
        this.missingDatabaseLogged = true;
      }
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      const item = await this.inbox.claimNext();
      if (!item) return;
      try {
        const event = this.payments.verifyWebhookEvent(item.payload);
        await this.payments.processWebhookEvent(event, item.id);
      } catch (error) {
        const reason =
          error instanceof Error ? error.message : "Erro inesperado no webhook";
        await this.inbox.markFailed(item.id, reason);
        this.logger.error(
          `Falha ao processar evento Asaas ${item.identificadorEvento}: ${reason}`,
        );
      }
    } finally {
      this.running = false;
    }
  }
}
