import { Prisma } from "@prisma/client";

export interface PaymentOrder {
  id: string;
  numeroPedido: bigint;
  nomeContatoSnapshot: string | null;
  telefoneSnapshot: string | null;
  valorTotal: Prisma.Decimal;
  expiresAt: Date | null;
}

export interface PaymentCredentials {
  apiKey: string;
}

export interface PaymentProvider {
  readonly kind: "MANUAL" | "ASAAS";
}

export interface PixCharge {
  providerReference: string;
  status: "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "CANCELLED";
  copyPaste: string | null;
  qrCodeImage: string | null;
  expiresAt: Date | null;
  amount: Prisma.Decimal;
  currency: "BRL";
}

export interface VerifiedPaymentEvent {
  eventId: string;
  providerReference: string;
  event: string;
}

export interface AutomatedPaymentProvider extends PaymentProvider {
  createPixCharge(
    order: PaymentOrder,
    credentials: PaymentCredentials,
    idempotencyKey: string,
  ): Promise<PixCharge>;
  getCharge(
    providerReference: string,
    credentials: PaymentCredentials,
  ): Promise<PixCharge>;
  cancelCharge(
    providerReference: string,
    credentials: PaymentCredentials,
  ): Promise<void>;
  refundCharge(
    providerReference: string,
    credentials: PaymentCredentials,
    amount?: Prisma.Decimal,
  ): Promise<void>;
  validateWebhook(
    accessToken: string | undefined,
    expectedToken: string,
    rawBody: Buffer,
  ): VerifiedPaymentEvent;
}

export const ASAAS_PAYMENT_PROVIDER = Symbol("ASAAS_PAYMENT_PROVIDER");
