import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Prisma,
  PrismaClient,
  ProvedorPagamento,
  StatusWebhook,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { VerifiedPaymentEvent } from "./payment-provider";

export interface PendingWebhook {
  id: string;
  identificadorEvento: string;
  referenciaExterna: string | null;
  payload: Prisma.JsonValue | null;
}

interface PaymentTenantResolution {
  restaurante_id: string;
  pagamento_id: string;
}

@Injectable()
export class WebhookInboxDatabase implements OnModuleDestroy {
  private client?: PrismaClient;

  constructor(private readonly config: ConfigService) {}

  async onModuleDestroy(): Promise<void> {
    if (this.client) await this.client.$disconnect();
  }

  async receive(
    event: VerifiedPaymentEvent,
    payload: Prisma.InputJsonValue,
  ): Promise<void> {
    const client = this.getClient();
    await client.webhookInbox.upsert({
      where: {
        provedor_identificadorEvento: {
          provedor: ProvedorPagamento.ASAAS,
          identificadorEvento: event.eventId,
        },
      },
      create: {
        provedor: ProvedorPagamento.ASAAS,
        identificadorEvento: event.eventId,
        referenciaExterna: event.providerReference,
        payload,
      },
      update: {},
    });
  }

  async claimNext(): Promise<PendingWebhook | null> {
    const client = this.getClient();
    return client.$transaction(async (tx) => {
      const staleBefore = new Date(Date.now() - 5 * 60_000);
      const event = await tx.webhookInbox.findFirst({
        where: {
          provedor: ProvedorPagamento.ASAAS,
          OR: [
            { status: { in: [StatusWebhook.RECEBIDO, StatusWebhook.FALHA] } },
            {
              status: StatusWebhook.PROCESSANDO,
              recebidoEm: { lt: staleBefore },
            },
          ],
        },
        orderBy: { recebidoEm: "asc" },
        select: {
          id: true,
          identificadorEvento: true,
          referenciaExterna: true,
          payload: true,
          status: true,
          resultado: true,
        },
      });
      if (!event) return null;
      const claim = await tx.webhookInbox.updateMany({
        where: {
          id: event.id,
          status: event.status,
          resultado: event.resultado,
        },
        data: {
          status: StatusWebhook.PROCESSANDO,
          resultado: `claim-${randomUUID()}`,
        },
      });
      return claim.count === 1
        ? {
            id: event.id,
            identificadorEvento: event.identificadorEvento,
            referenciaExterna: event.referenciaExterna,
            payload: event.payload,
          }
        : null;
    });
  }

  async markProcessed(id: string): Promise<void> {
    await this.getClient().webhookInbox.update({
      where: { id },
      data: {
        status: StatusWebhook.PROCESSADO,
        processadoEm: new Date(),
        resultado: "Pagamento sincronizado",
      },
    });
  }

  async markFailed(id: string, reason: string): Promise<void> {
    await this.getClient().webhookInbox.update({
      where: { id },
      data: {
        status: StatusWebhook.FALHA,
        resultado: reason.slice(0, 255),
      },
    });
  }

  async markRejected(id: string, reason: string): Promise<void> {
    await this.getClient().webhookInbox.update({
      where: { id },
      data: {
        status: StatusWebhook.REJEITADO,
        processadoEm: new Date(),
        resultado: reason.slice(0, 255),
      },
    });
  }

  async resolvePayment(
    providerReference: string,
  ): Promise<PaymentTenantResolution | null> {
    const rows = await this.getClient().$queryRaw<PaymentTenantResolution[]>`
      SELECT restaurante_id, pagamento_id
      FROM public.resolve_asaas_webhook_payment(${providerReference})
    `;
    return rows[0] ?? null;
  }

  private getClient(): PrismaClient {
    if (this.client) return this.client;
    const databaseUrl = this.config.get<string>("WEBHOOK_DATABASE_URL");
    if (!databaseUrl) {
      throw new ServiceUnavailableException(
        "WEBHOOK_DATABASE_URL não está configurada para o processador restrito",
      );
    }
    this.client = new PrismaClient({
      datasources: { db: { url: databaseUrl } },
    });
    return this.client;
  }
}
