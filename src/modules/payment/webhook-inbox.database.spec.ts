import { ConfigService } from "@nestjs/config";
import { ProvedorPagamento, StatusWebhook } from "@prisma/client";
import { WebhookInboxDatabase } from "./webhook-inbox.database";

describe("WebhookInboxDatabase", () => {
  it("uses the provider/event unique key so duplicate deliveries are idempotent", async () => {
    const database = new WebhookInboxDatabase({
      get: jest.fn(),
    } as unknown as ConfigService);
    const upsert = jest.fn().mockResolvedValue({});
    Object.defineProperty(database, "client", {
      value: { webhookInbox: { upsert } },
    });
    const event = {
      eventId: "evt-123",
      providerReference: "pay-123",
      event: "PAYMENT_CONFIRMED",
    };
    const payload = {
      id: event.eventId,
      event: event.event,
      payment: { id: event.providerReference },
    };

    await database.receive(event, payload);
    await database.receive(event, payload);

    expect(upsert).toHaveBeenCalledTimes(2);
    expect(upsert).toHaveBeenCalledWith({
      where: {
        provedor_identificadorEvento: {
          provedor: ProvedorPagamento.ASAAS,
          identificadorEvento: "evt-123",
        },
      },
      create: {
        provedor: ProvedorPagamento.ASAAS,
        identificadorEvento: "evt-123",
        referenciaExterna: "pay-123",
        payload,
      },
      update: {},
    });
  });

  it("claims webhook rows with compare-and-set to avoid concurrent processing", async () => {
    const database = new WebhookInboxDatabase({
      get: jest.fn(),
    } as unknown as ConfigService);
    const event = {
      id: "inbox-id",
      identificadorEvento: "evt-123",
      referenciaExterna: "pay-123",
      payload: { id: "evt-123" },
      status: StatusWebhook.PROCESSANDO,
      resultado: "claim-old",
    };
    const findFirst = jest.fn().mockResolvedValue(event);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const transaction = jest.fn((callback: (tx: unknown) => unknown) =>
      callback({
        webhookInbox: { findFirst, updateMany },
      }),
    );
    Object.defineProperty(database, "client", {
      value: { $transaction: transaction },
    });

    await expect(database.claimNext()).resolves.toMatchObject({
      id: "inbox-id",
      identificadorEvento: "evt-123",
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "inbox-id",
        status: StatusWebhook.PROCESSANDO,
        resultado: "claim-old",
      },
      data: {
        status: StatusWebhook.PROCESSANDO,
        resultado: expect.stringMatching(/^claim-/),
      },
    });
  });
});
