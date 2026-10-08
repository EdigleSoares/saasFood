import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { AsaasModule } from "../asaas/asaas.module";
import { AsaasAdapter } from "../asaas/asaas.adapter";
import { AsaasWebhookController } from "./asaas-webhook.controller";
import { PaymentController } from "./payment.controller";
import { PaymentService } from "./payment.service";
import { ManualPixProvider } from "./manual-pix.provider";
import { PublicPaymentController } from "./public-payment.controller";
import { WebhookInboxDatabase } from "./webhook-inbox.database";
import { WebhookInboxProcessor } from "./webhook-inbox.processor";
import { ASAAS_PAYMENT_PROVIDER } from "./payment-provider";

@Module({
  imports: [AuthModule, AsaasModule],
  controllers: [
    PaymentController,
    PublicPaymentController,
    AsaasWebhookController,
  ],
  providers: [
    PaymentService,
    { provide: ASAAS_PAYMENT_PROVIDER, useExisting: AsaasAdapter },
    ManualPixProvider,
    WebhookInboxDatabase,
    WebhookInboxProcessor,
  ],
  exports: [PaymentService],
})
export class PaymentModule {}
