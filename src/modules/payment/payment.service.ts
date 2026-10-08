import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  FormaPagamento,
  Prisma,
  ProvedorPagamento,
  StatusPagamento,
  StatusPedido,
  TipoAtorEvento,
} from "@prisma/client";
import { createHash } from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { decryptPaymentSecret, encryptPaymentSecret } from "./payment-crypto";
import { ManualPixProvider } from "./manual-pix.provider";
import {
  assertPaymentTransition,
  mapChargeToPaymentStatus,
} from "./payment-rules";
import { validateOrderTransition } from "../order/order-rules";
import {
  ASAAS_PAYMENT_PROVIDER,
  AutomatedPaymentProvider,
  VerifiedPaymentEvent,
} from "./payment-provider";
import { WebhookInboxDatabase } from "./webhook-inbox.database";

@Injectable()
export class PaymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(ASAAS_PAYMENT_PROVIDER)
    private readonly asaas: AutomatedPaymentProvider,
    private readonly manualPix: ManualPixProvider,
    private readonly webhookInbox: WebhookInboxDatabase,
  ) {}

  async configureManualPix(
    restauranteId: string,
    tipoChave: string,
    chave: string,
    nomeRecebedor: string,
  ): Promise<{ ativa: true }> {
    const normalized = this.normalizePixKey(tipoChave, chave);
    const encrypted = encryptPaymentSecret(normalized, this.config);
    await this.prisma.withTenant(restauranteId, async (tx) => {
      await tx.configuracaoPixManual.upsert({
        where: { restauranteId },
        create: {
          restauranteId,
          tipoChave,
          chaveCifrada: encrypted,
          nomeRecebedor: nomeRecebedor.trim(),
          ativa: true,
        },
        update: {
          tipoChave,
          chaveCifrada: encrypted,
          nomeRecebedor: nomeRecebedor.trim(),
          ativa: true,
        },
      });
      await tx.configuracaoRestaurante.update({
        where: { restauranteId },
        data: { aceitarPixManual: true },
      });
    });
    return { ativa: true };
  }

  async configureAsaas(
    restauranteId: string,
    apiKey: string,
  ): Promise<{ ativa: true }> {
    if (!apiKey.trim()) throw new BadRequestException("Chave API obrigatória");
    const encrypted = encryptPaymentSecret(apiKey.trim(), this.config);
    await this.prisma.withTenant(restauranteId, async (tx) => {
      await tx.credencialGateway.upsert({
        where: {
          restauranteId_provedor: {
            restauranteId,
            provedor: ProvedorPagamento.ASAAS,
          },
        },
        create: {
          restauranteId,
          provedor: ProvedorPagamento.ASAAS,
          credencialCifrada: encrypted,
          ativa: true,
        },
        update: {
          credencialCifrada: encrypted,
          ativa: true,
          ultimoErroCodigo: null,
        },
      });
      await tx.configuracaoRestaurante.update({
        where: { restauranteId },
        data: { aceitarPixAsaas: true },
      });
    });
    return { ativa: true };
  }

  async publicInstructions(restauranteId: string, trackingToken: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(trackingToken)) {
      throw new NotFoundException("Instruções de pagamento não encontradas");
    }
    const hash = this.hash(trackingToken);
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const order = await tx.pedido.findFirst({
        where: { restauranteId, trackingTokenHash: hash },
        select: {
          id: true,
          formaPagamento: true,
          pagamentos: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              status: true,
              valor: true,
              moeda: true,
              copiaECola: true,
              qrCodeImagem: true,
              expiraEm: true,
            },
          },
        },
      });
      if (!order) {
        throw new NotFoundException("Instruções de pagamento não encontradas");
      }
      const payment = order.pagamentos[0];
      if (!payment) throw new NotFoundException("Pagamento não encontrado");
      if (order.formaPagamento === FormaPagamento.PIX_MANUAL) {
        const pix = await tx.configuracaoPixManual.findUnique({
          where: { restauranteId },
        });
        if (!pix?.ativa) {
          throw new ConflictException("Pix manual não está disponível");
        }
        return {
          status: payment.status,
          valor: payment.valor,
          moeda: payment.moeda,
          ...this.manualPix.createInstructions(
            pix.tipoChave,
            decryptPaymentSecret(pix.chaveCifrada, this.config),
            pix.nomeRecebedor,
          ),
        };
      }
      return {
        status: payment.status,
        valor: payment.valor,
        moeda: payment.moeda,
        copiaECola: payment.copiaECola,
        qrCodeImagem: payment.qrCodeImagem,
        expiraEm: payment.expiraEm,
      };
    });
  }

  async confirmManualPayment(
    restauranteId: string,
    orderId: string,
    usuarioId: string,
    accepted: boolean,
    reason?: string,
  ) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const payment = await tx.pagamento.findFirst({
        where: {
          restauranteId,
          pedidoId: orderId,
          forma: FormaPagamento.PIX_MANUAL,
          status: StatusPagamento.AGUARDANDO_CONFIRMACAO_MANUAL,
        },
        orderBy: { createdAt: "desc" },
      });
      if (!payment) {
        throw new NotFoundException(
          "Pix manual aguardando confirmação não encontrado",
        );
      }
      const nextStatus = accepted
        ? StatusPagamento.PAGO
        : StatusPagamento.FALHOU;
      assertPaymentTransition(payment.status, nextStatus);
      const update = await tx.pagamento.updateMany({
        where: {
          restauranteId,
          id: payment.id,
          status: StatusPagamento.AGUARDANDO_CONFIRMACAO_MANUAL,
        },
        data: {
          status: nextStatus,
          ...(accepted ? { pagoEm: new Date() } : {}),
          metadados: {
            decisaoManual: accepted ? "CONFIRMADO" : "REJEITADO",
            usuarioId,
            motivo: reason?.trim() ?? null,
          },
        },
      });
      if (update.count !== 1) {
        throw new ConflictException(
          "O pagamento foi atualizado por outra operação",
        );
      }
      await tx.outboxEvento.create({
        data: {
          restauranteId,
          tipo: accepted
            ? "PAGAMENTO_MANUAL_CONFIRMADO"
            : "PAGAMENTO_MANUAL_REJEITADO",
          agregadoTipo: "PAGAMENTO",
          agregadoId: payment.id,
          payload: { pedidoId: orderId, usuarioId, status: nextStatus },
        },
      });
      return tx.pagamento.findUniqueOrThrow({
        where: {
          restauranteId_id: { restauranteId, id: payment.id },
        },
        select: {
          id: true,
          pedidoId: true,
          status: true,
          valor: true,
          pagoEm: true,
          canceladoEm: true,
        },
      });
    });
  }

  async createAsaasCharge(restauranteId: string, orderId: string) {
    const details = await this.prisma.withTenant(restauranteId, async (tx) => {
      const payment = await tx.pagamento.findFirst({
        where: {
          restauranteId,
          pedidoId: orderId,
          forma: FormaPagamento.PIX_ASAAS,
        },
        orderBy: { createdAt: "desc" },
        include: {
          pedido: {
            select: {
              id: true,
              restauranteId: true,
              numeroPedido: true,
              nomeContatoSnapshot: true,
              telefoneSnapshot: true,
              valorTotal: true,
              status: true,
            },
          },
        },
      });
      if (!payment)
        throw new NotFoundException("Pagamento Asaas não encontrado");
      if (payment.status === StatusPagamento.AGUARDANDO_PAGAMENTO) {
        return {
          payment,
          order: {
            ...payment.pedido,
            expiresAt: payment.expiraEm,
          },
          credentials: null,
        };
      }
      if (payment.status !== StatusPagamento.AGUARDANDO_CRIACAO_GATEWAY) {
        throw new ConflictException("Pagamento não pode gerar cobrança Asaas");
      }
      if (payment.pedido.status !== "ACEITO") {
        throw new ConflictException(
          "A cobrança Asaas só pode ser criada após o aceite",
        );
      }
      const credential = await tx.credencialGateway.findFirst({
        where: {
          restauranteId,
          provedor: ProvedorPagamento.ASAAS,
          ativa: true,
        },
      });
      if (!credential)
        throw new ConflictException("Conta Asaas não configurada");
      return {
        payment,
        order: {
          ...payment.pedido,
          expiresAt: payment.expiraEm,
        },
        credentials: decryptPaymentSecret(
          credential.credencialCifrada,
          this.config,
        ),
      };
    });
    if (!details.credentials) {
      return {
        id: details.payment.id,
        status: details.payment.status,
        copiaECola: details.payment.copiaECola,
        qrCodeImagem: details.payment.qrCodeImagem,
        expiraEm: details.payment.expiraEm,
      };
    }

    const charge = await this.asaas.createPixCharge(
      details.order,
      { apiKey: details.credentials },
      details.payment.id,
    );
    if (
      !charge.amount.equals(details.payment.valor) ||
      charge.currency !== details.payment.moeda
    ) {
      throw new ConflictException(
        "Valor/moeda da cobrança Asaas não corresponde ao pedido",
      );
    }
    const status =
      charge.status === "PAID"
        ? StatusPagamento.PAGO
        : charge.status === "FAILED"
          ? StatusPagamento.FALHOU
          : charge.status === "EXPIRED"
            ? StatusPagamento.EXPIRADO
            : charge.status === "CANCELLED"
              ? StatusPagamento.CANCELADO
              : StatusPagamento.AGUARDANDO_PAGAMENTO;
    return this.prisma.withTenant(restauranteId, async (tx) => {
      assertPaymentTransition(details.payment.status, status);
      const update = await tx.pagamento.updateMany({
        where: {
          restauranteId,
          id: details.payment.id,
          status: StatusPagamento.AGUARDANDO_CRIACAO_GATEWAY,
        },
        data: {
          referenciaExterna: charge.providerReference,
          copiaECola: charge.copyPaste,
          qrCodeImagem: charge.qrCodeImage,
          expiraEm: charge.expiresAt ?? details.payment.expiraEm,
          status,
          ...(status === StatusPagamento.PAGO ? { pagoEm: new Date() } : {}),
        },
      });
      if (update.count !== 1) {
        throw new ConflictException(
          "Pagamento atualizado durante criação de cobrança",
        );
      }
      return {
        id: details.payment.id,
        status,
        copiaECola: charge.copyPaste,
        qrCodeImagem: charge.qrCodeImage,
        expiraEm: charge.expiresAt ?? details.payment.expiraEm,
      };
    });
  }

  async refundAsaas(restauranteId: string, paymentId: string, amount?: string) {
    const payment = await this.prisma.withTenant(restauranteId, async (tx) => {
      const selected = await tx.pagamento.findFirst({
        where: { restauranteId, id: paymentId },
      });
      if (!selected) throw new NotFoundException("Pagamento não encontrado");
      if (
        selected.provedor !== ProvedorPagamento.ASAAS ||
        selected.status !== StatusPagamento.PAGO ||
        !selected.referenciaExterna
      ) {
        throw new ConflictException(
          "Pagamento não está elegível para estorno Asaas",
        );
      }
      const credential = await tx.credencialGateway.findFirst({
        where: {
          restauranteId,
          provedor: ProvedorPagamento.ASAAS,
          ativa: true,
        },
      });
      if (!credential)
        throw new ConflictException("Conta Asaas não configurada");
      const refundValue = amount ? new Prisma.Decimal(amount) : undefined;
      if (
        refundValue &&
        (refundValue.isNegative() ||
          refundValue.isZero() ||
          refundValue.greaterThan(selected.valor) ||
          refundValue.decimalPlaces() > 2)
      ) {
        throw new BadRequestException("Valor do estorno inválido");
      }
      return {
        selected,
        apiKey: decryptPaymentSecret(credential.credencialCifrada, this.config),
        refundValue,
      };
    });
    const refundClaim = await this.prisma.withTenant(restauranteId, (tx) =>
      tx.pagamento.updateMany({
        where: {
          restauranteId,
          id: payment.selected.id,
          status: StatusPagamento.PAGO,
        },
        data: { status: StatusPagamento.ESTORNO_PENDENTE },
      }),
    );
    if (refundClaim.count !== 1) {
      throw new ConflictException("Pagamento foi atualizado em paralelo");
    }
    await this.asaas.refundCharge(
      payment.selected.referenciaExterna!,
      { apiKey: payment.apiKey },
      payment.refundValue,
    );
    return {
      id: payment.selected.id,
      status: StatusPagamento.ESTORNO_PENDENTE,
    };
  }

  async cancelAsaasCharge(
    restauranteId: string,
    orderId: string,
  ): Promise<{ refundRequired: boolean } | null> {
    const details = await this.prisma.withTenant(restauranteId, async (tx) => {
      const payment = await tx.pagamento.findFirst({
        where: {
          restauranteId,
          pedidoId: orderId,
          forma: FormaPagamento.PIX_ASAAS,
        },
        orderBy: { createdAt: "desc" },
      });
      if (!payment || payment.status === StatusPagamento.CANCELADO) return null;
      if (
        payment.status === StatusPagamento.PAGO ||
        payment.status === StatusPagamento.ESTORNO_PENDENTE ||
        payment.status === StatusPagamento.ESTORNADO
      ) {
        return { payment, apiKey: null, refundRequired: true };
      }
      if (
        payment.status !== StatusPagamento.AGUARDANDO_CRIACAO_GATEWAY &&
        payment.status !== StatusPagamento.AGUARDANDO_PAGAMENTO
      ) {
        return null;
      }
      const credential = payment.referenciaExterna
        ? await tx.credencialGateway.findFirst({
            where: {
              restauranteId,
              provedor: ProvedorPagamento.ASAAS,
              ativa: true,
            },
          })
        : null;
      if (payment.referenciaExterna && !credential) {
        throw new ConflictException(
          "Conta Asaas não está disponível para cancelar",
        );
      }
      return {
        payment,
        apiKey: credential
          ? decryptPaymentSecret(credential.credencialCifrada, this.config)
          : null,
        refundRequired: false,
      };
    });
    if (!details) return null;
    if (details.refundRequired) {
      await this.prisma.withTenant(restauranteId, (tx) =>
        tx.outboxEvento.create({
          data: {
            restauranteId,
            tipo: "ESTORNO_MANUAL_NECESSARIO",
            agregadoTipo: "PAGAMENTO",
            agregadoId: details.payment.id,
            payload: { pedidoId: orderId },
          },
        }),
      );
      return { refundRequired: true };
    }
    if (details.payment.referenciaExterna && details.apiKey) {
      await this.asaas.cancelCharge(details.payment.referenciaExterna, {
        apiKey: details.apiKey,
      });
    }
    await this.prisma.withTenant(restauranteId, async (tx) => {
      assertPaymentTransition(
        details.payment.status,
        StatusPagamento.CANCELADO,
      );
      const update = await tx.pagamento.updateMany({
        where: {
          restauranteId,
          id: details.payment.id,
          status: details.payment.status,
        },
        data: {
          status: StatusPagamento.CANCELADO,
          canceladoEm: new Date(),
        },
      });
      if (update.count !== 1) {
        throw new ConflictException("Pagamento foi atualizado em paralelo");
      }
      await tx.outboxEvento.create({
        data: {
          restauranteId,
          tipo: "PAGAMENTO_CANCELADO",
          agregadoTipo: "PAGAMENTO",
          agregadoId: details.payment.id,
          payload: { pedidoId: orderId },
        },
      });
    });
    return { refundRequired: false };
  }

  async receiveAsaasWebhook(
    accessToken: string | undefined,
    rawBody: Buffer | undefined,
  ): Promise<{ accepted: true }> {
    if (!rawBody || rawBody.length > 100_000) {
      throw new BadRequestException(
        "Payload de webhook inválido ou excede o limite",
      );
    }
    const expected = this.config.get<string>("ASAAS_WEBHOOK_AUTH_TOKEN", "");
    const event = this.asaas.validateWebhook(accessToken, expected, rawBody);
    const payload = this.minimalWebhookPayload(event);
    await this.webhookInbox.receive(event, payload);
    return { accepted: true };
  }

  async processWebhookEvent(
    event: VerifiedPaymentEvent,
    inboxId: string,
  ): Promise<"processed" | "rejected"> {
    const resolution = await this.webhookInbox.resolvePayment(
      event.providerReference,
    );
    if (!resolution) {
      await this.webhookInbox.markRejected(
        inboxId,
        "Referência não reconhecida",
      );
      return "rejected";
    }
    const lookup = await this.prisma.withTenant(
      resolution.restaurante_id,
      async (tx) => {
        const payment = await tx.pagamento.findFirst({
          where: {
            restauranteId: resolution.restaurante_id,
            id: resolution.pagamento_id,
            referenciaExterna: event.providerReference,
            provedor: ProvedorPagamento.ASAAS,
          },
        });
        if (!payment) return null;
        const credential = await tx.credencialGateway.findFirst({
          where: {
            restauranteId: resolution.restaurante_id,
            provedor: ProvedorPagamento.ASAAS,
            ativa: true,
          },
        });
        return {
          payment,
          apiKey: credential
            ? decryptPaymentSecret(credential.credencialCifrada, this.config)
            : null,
        };
      },
    );
    if (!lookup?.apiKey) {
      await this.webhookInbox.markRejected(
        inboxId,
        "Pagamento ou credencial Asaas não está ativo",
      );
      return "rejected";
    }

    const charge = await this.asaas.getCharge(event.providerReference, {
      apiKey: lookup.apiKey,
    });
    if (
      charge.providerReference !== event.providerReference ||
      !charge.amount.equals(lookup.payment.valor) ||
      charge.currency !== lookup.payment.moeda
    ) {
      await this.webhookInbox.markRejected(
        inboxId,
        "Referência, valor ou moeda não corresponde ao pagamento",
      );
      return "rejected";
    }
    const next = mapChargeToPaymentStatus(charge, event.event);
    await this.prisma.withTenant(resolution.restaurante_id, async (tx) => {
      const payment = await tx.pagamento.findFirst({
        where: {
          restauranteId: resolution.restaurante_id,
          id: resolution.pagamento_id,
          referenciaExterna: event.providerReference,
          provedor: ProvedorPagamento.ASAAS,
        },
      });
      if (!payment) throw new NotFoundException("Pagamento não encontrado");
      if (payment.status === next) return;
      assertPaymentTransition(payment.status, next);
      const update = await tx.pagamento.updateMany({
        where: {
          restauranteId: resolution.restaurante_id,
          id: payment.id,
          status: payment.status,
        },
        data: {
          status: next,
          ...(next === StatusPagamento.PAGO ? { pagoEm: new Date() } : {}),
          ...(next === StatusPagamento.CANCELADO ||
          next === StatusPagamento.ESTORNADO
            ? { canceladoEm: new Date() }
            : {}),
        },
      });
      if (update.count !== 1) {
        throw new ConflictException("Pagamento foi atualizado em paralelo");
      }
      await tx.outboxEvento.create({
        data: {
          restauranteId: resolution.restaurante_id,
          tipo: "PAGAMENTO_STATUS_ATUALIZADO",
          agregadoTipo: "PAGAMENTO",
          agregadoId: payment.id,
          payload: {
            pedidoId: payment.pedidoId,
            status: next,
            evento: event.event,
          },
        },
      });
      if (
        next === StatusPagamento.CANCELADO ||
        next === StatusPagamento.EXPIRADO
      ) {
        const order = await tx.pedido.findFirst({
          where: {
            restauranteId: resolution.restaurante_id,
            id: payment.pedidoId,
          },
          select: { id: true, status: true, tipoEntrega: true },
        });
        if (order?.status === StatusPedido.ACEITO) {
          validateOrderTransition(
            order.status,
            StatusPedido.CANCELADO,
            order.tipoEntrega,
            next === StatusPagamento.EXPIRADO
              ? "Cobrança Pix expirou"
              : "Cobrança Pix cancelada no Asaas",
          );
          const orderUpdate = await tx.pedido.updateMany({
            where: {
              restauranteId: resolution.restaurante_id,
              id: order.id,
              status: order.status,
            },
            data: { status: StatusPedido.CANCELADO },
          });
          if (orderUpdate.count !== 1) {
            throw new ConflictException("Pedido foi atualizado em paralelo");
          }
          await tx.eventoStatusPedido.create({
            data: {
              restauranteId: resolution.restaurante_id,
              pedidoId: order.id,
              atorTipo: TipoAtorEvento.SISTEMA,
              statusAnterior: order.status,
              statusNovo: StatusPedido.CANCELADO,
              motivo:
                next === StatusPagamento.EXPIRADO
                  ? "Cobrança Pix expirou"
                  : "Cobrança Pix cancelada no Asaas",
            },
          });
          await tx.outboxEvento.create({
            data: {
              restauranteId: resolution.restaurante_id,
              tipo: "STATUS_PEDIDO_ATUALIZADO",
              agregadoTipo: "PEDIDO",
              agregadoId: order.id,
              payload: {
                pedidoId: order.id,
                status: StatusPedido.CANCELADO,
              },
            },
          });
        }
      }
    });
    await this.webhookInbox.markProcessed(inboxId);
    return "processed";
  }

  verifyWebhookEvent(payload: Prisma.JsonValue | null): VerifiedPaymentEvent {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new BadRequestException("Evento armazenado inválido");
    }
    const event = payload as Prisma.JsonObject;
    const payment = event.payment;
    if (
      typeof event.id !== "string" ||
      typeof event.event !== "string" ||
      !payment ||
      typeof payment !== "object" ||
      Array.isArray(payment) ||
      typeof payment.id !== "string"
    ) {
      throw new BadRequestException("Evento armazenado incompleto");
    }
    return {
      eventId: event.id,
      event: event.event,
      providerReference: payment.id,
    };
  }

  private normalizePixKey(type: string, value: string): string {
    const key = value.trim();
    const digits = key.replace(/\D/g, "");
    const valid =
      (type === "CPF" && this.isValidCpf(digits)) ||
      (type === "CNPJ" && this.isValidCnpj(digits)) ||
      (type === "CELULAR" && [10, 11, 12, 13].includes(digits.length)) ||
      (type === "EMAIL" &&
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) &&
        key.length <= 254) ||
      (type === "ALEATORIA" &&
        /^(?:[A-Fa-f0-9]{32}|[A-Fa-f0-9]{8}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{12})$/.test(
          key,
        ));
    if (!valid)
      throw new BadRequestException("Chave Pix inválida para o tipo informado");
    return type === "CPF" || type === "CNPJ" || type === "CELULAR"
      ? digits
      : key;
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private isValidCpf(value: string): boolean {
    if (!/^\d{11}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
    const calculate = (length: number) => {
      let sum = 0;
      for (let index = 0; index < length; index += 1) {
        sum += Number(value[index]) * (length + 1 - index);
      }
      const remainder = (sum * 10) % 11;
      return remainder === 10 ? 0 : remainder;
    };
    return (
      calculate(9) === Number(value[9]) && calculate(10) === Number(value[10])
    );
  }

  private isValidCnpj(value: string): boolean {
    if (!/^\d{14}$/.test(value) || /^(\d)\1+$/.test(value)) return false;
    const digit = (length: number) => {
      const weights =
        length === 12
          ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
          : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = weights.reduce(
        (total, weight, index) => total + Number(value[index]) * weight,
        0,
      );
      const remainder = sum % 11;
      return remainder < 2 ? 0 : 11 - remainder;
    };
    return digit(12) === Number(value[12]) && digit(13) === Number(value[13]);
  }

  private minimalWebhookPayload(
    event: VerifiedPaymentEvent,
  ): Prisma.InputJsonValue {
    return {
      id: event.eventId,
      event: event.event,
      payment: { id: event.providerReference },
    };
  }
}
