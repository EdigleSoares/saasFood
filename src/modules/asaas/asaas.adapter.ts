import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import { timingSafeEqual } from "node:crypto";
import {
  AutomatedPaymentProvider,
  PaymentCredentials,
  PaymentOrder,
  PixCharge,
  VerifiedPaymentEvent,
} from "../payment/payment-provider";
import { mapAsaasStatus } from "../payment/payment-rules";

interface AsaasPaymentResponse {
  id: string;
  status: string;
  value: number;
  dueDate?: string;
  paymentDate?: string;
}

@Injectable()
export class AsaasAdapter implements AutomatedPaymentProvider {
  readonly kind = "ASAAS" as const;

  constructor(private readonly config: ConfigService) {}

  async createPixCharge(
    order: PaymentOrder,
    credentials: PaymentCredentials,
    idempotencyKey: string,
  ): Promise<PixCharge> {
    const customer = await this.request<{ id: string }>(
      "/customers",
      credentials,
      {
        method: "POST",
        headers: { "asaas-idempotency-key": `customer-${idempotencyKey}` },
        body: JSON.stringify({
          name: order.nomeContatoSnapshot ?? "Cliente",
          phone: order.telefoneSnapshot ?? undefined,
          externalReference: order.id,
        }),
      },
    );
    const payment = await this.request<AsaasPaymentResponse>(
      "/payments",
      credentials,
      {
        method: "POST",
        headers: { "asaas-idempotency-key": idempotencyKey },
        body: JSON.stringify({
          customer: customer.id,
          billingType: "PIX",
          value: Number(order.valorTotal.toFixed(2)),
          dueDate: (order.expiresAt ?? new Date(Date.now() + 30 * 60_000))
            .toISOString()
            .slice(0, 10),
          description: `Pedido ${order.numeroPedido.toString()}`,
          externalReference: order.id,
        }),
      },
    );

    const pix = await this.request<{
      encodedImage?: string;
      payload?: string;
      expirationDate?: string;
    }>(`/payments/${encodeURIComponent(payment.id)}/pixQrCode`, credentials);

    return {
      providerReference: payment.id,
      status: mapAsaasStatus(payment.status),
      copyPaste: pix.payload ?? null,
      qrCodeImage: pix.encodedImage ?? null,
      expiresAt: pix.expirationDate ? new Date(pix.expirationDate) : null,
      amount: new Prisma.Decimal(payment.value),
      currency: "BRL",
    };
  }

  async getCharge(
    providerReference: string,
    credentials: PaymentCredentials,
  ): Promise<PixCharge> {
    const payment = await this.request<AsaasPaymentResponse>(
      `/payments/${encodeURIComponent(providerReference)}`,
      credentials,
    );
    return {
      providerReference: payment.id,
      status: mapAsaasStatus(payment.status),
      copyPaste: null,
      qrCodeImage: null,
      expiresAt: payment.dueDate
        ? new Date(`${payment.dueDate}T23:59:59.999Z`)
        : null,
      amount: new Prisma.Decimal(payment.value),
      currency: "BRL",
    };
  }

  async cancelCharge(
    providerReference: string,
    credentials: PaymentCredentials,
  ): Promise<void> {
    await this.request(
      `/payments/${encodeURIComponent(providerReference)}`,
      credentials,
      { method: "DELETE" },
    );
  }

  async refundCharge(
    providerReference: string,
    credentials: PaymentCredentials,
    amount?: Prisma.Decimal,
  ): Promise<void> {
    await this.request(
      `/payments/${encodeURIComponent(providerReference)}/refund`,
      credentials,
      {
        method: "POST",
        ...(amount
          ? { body: JSON.stringify({ value: Number(amount.toFixed(2)) }) }
          : {}),
      },
    );
  }

  validateWebhook(
    accessToken: string | undefined,
    expectedToken: string,
    rawBody: Buffer,
  ): VerifiedPaymentEvent {
    if (
      !expectedToken ||
      !this.constantTimeEquals(accessToken, expectedToken)
    ) {
      throw new UnauthorizedException("Token de webhook Asaas inválido");
    }
    let body: unknown;
    try {
      body = JSON.parse(rawBody.toString("utf8"));
    } catch {
      throw new BadRequestException("Payload do webhook Asaas inválido");
    }
    if (!body || typeof body !== "object") {
      throw new BadRequestException("Payload do webhook Asaas inválido");
    }
    const record = body as Record<string, unknown>;
    const payment = record.payment;
    if (
      typeof record.id !== "string" ||
      !record.id ||
      typeof record.event !== "string" ||
      !record.event ||
      !payment ||
      typeof payment !== "object" ||
      typeof (payment as Record<string, unknown>).id !== "string"
    ) {
      throw new BadRequestException("Payload do webhook Asaas incompleto");
    }
    return {
      eventId: record.id,
      event: record.event,
      providerReference: (payment as Record<string, string>).id,
    };
  }

  private async request<T>(
    path: string,
    credentials: PaymentCredentials,
    init: RequestInit = {},
  ): Promise<T> {
    const baseUrl = this.config
      .get<string>("ASAAS_API_BASE_URL", "https://api-sandbox.asaas.com/v3")
      .replace(/\/+$/, "");
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          access_token: credentials.apiKey,
          ...init.headers,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException("Falha de comunicação com Asaas");
    }
    const responseText = await response.text();
    if (!response.ok) {
      throw new BadGatewayException(
        `Asaas rejeitou a operação (HTTP ${response.status})`,
      );
    }
    if (!responseText) {
      return undefined as T;
    }
    try {
      return JSON.parse(responseText) as T;
    } catch {
      throw new BadGatewayException("Resposta inválida recebida do Asaas");
    }
  }

  private constantTimeEquals(
    provided: string | undefined,
    expected: string,
  ): boolean {
    if (
      !provided ||
      Buffer.byteLength(provided) !== Buffer.byteLength(expected)
    ) {
      return false;
    }
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  }
}
