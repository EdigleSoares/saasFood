import { ConfigService } from "@nestjs/config";
import { AsaasAdapter } from "./asaas.adapter";

describe("AsaasAdapter webhook validation", () => {
  const config = {
    get: jest.fn(),
  } as unknown as ConfigService;
  const adapter = new AsaasAdapter(config);

  it("accepts authenticated valid Asaas events", () => {
    const rawBody = Buffer.from(
      JSON.stringify({
        id: "evt-123",
        event: "PAYMENT_CONFIRMED",
        payment: { id: "pay-123" },
      }),
    );
    expect(
      adapter.validateWebhook("shared-secret", "shared-secret", rawBody),
    ).toEqual({
      eventId: "evt-123",
      event: "PAYMENT_CONFIRMED",
      providerReference: "pay-123",
    });
  });

  it("rejects invalid webhook credentials", () => {
    expect(() =>
      adapter.validateWebhook(
        "wrong-secret",
        "shared-secret",
        Buffer.from("{}"),
      ),
    ).toThrow("Token de webhook Asaas inválido");
  });

  it("rejects malformed event payloads", () => {
    expect(() =>
      adapter.validateWebhook(
        "shared-secret",
        "shared-secret",
        Buffer.from(JSON.stringify({ id: "evt-123" })),
      ),
    ).toThrow("Payload do webhook Asaas incompleto");
  });
});
