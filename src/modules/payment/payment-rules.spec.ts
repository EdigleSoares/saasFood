import { ConflictException } from "@nestjs/common";
import { Prisma, StatusPagamento } from "@prisma/client";
import {
  mapAsaasStatus,
  mapChargeToPaymentStatus,
  assertPaymentTransition,
} from "./payment-rules";

describe("payment rules", () => {
  it.each([
    ["PENDING", "PENDING"],
    ["CONFIRMED", "PAID"],
    ["RECEIVED", "PAID"],
    ["REFUSED", "FAILED"],
    ["OVERDUE", "EXPIRED"],
    ["DELETED", "CANCELLED"],
  ] as const)("maps Asaas status %s", (asaasStatus, expected) => {
    expect(mapAsaasStatus(asaasStatus)).toBe(expected);
  });

  it("rejects unknown provider statuses", () => {
    expect(() => mapAsaasStatus("UNRECOGNIZED")).toThrow(ConflictException);
  });

  it.each([
    ["PAYMENT_CONFIRMED", "PAID", StatusPagamento.PAGO],
    ["PAYMENT_OVERDUE", "EXPIRED", StatusPagamento.EXPIRADO],
    ["PAYMENT_REFUND_IN_PROGRESS", "PENDING", StatusPagamento.ESTORNO_PENDENTE],
    ["PAYMENT_REFUNDED", "CANCELLED", StatusPagamento.ESTORNADO],
  ] as const)("maps event %s to payment state", (event, status, expected) => {
    expect(
      mapChargeToPaymentStatus(
        {
          providerReference: "pay-123",
          status,
          copyPaste: null,
          qrCodeImage: null,
          expiresAt: null,
          amount: new Prisma.Decimal("15.00"),
          currency: "BRL",
        },
        event,
      ),
    ).toBe(expected);
  });

  it("accepts legal payment state changes and rejects illegal ones", () => {
    expect(() =>
      assertPaymentTransition(
        StatusPagamento.AGUARDANDO_PAGAMENTO,
        StatusPagamento.PAGO,
      ),
    ).not.toThrow();
    expect(() =>
      assertPaymentTransition(StatusPagamento.ESTORNADO, StatusPagamento.PAGO),
    ).toThrow(ConflictException);
  });
});
