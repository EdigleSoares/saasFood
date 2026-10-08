import { ConflictException } from "@nestjs/common";
import { StatusPagamento } from "@prisma/client";
import { PixCharge } from "./payment-provider";

const asaasStatusMap: Record<string, PixCharge["status"]> = {
  PENDING: "PENDING",
  AWAITING_RISK_ANALYSIS: "PENDING",
  CONFIRMED: "PAID",
  RECEIVED: "PAID",
  RECEIVED_IN_CASH: "PAID",
  REFUSED: "FAILED",
  OVERDUE: "EXPIRED",
  DELETED: "CANCELLED",
  REFUNDED: "CANCELLED",
  REFUND_IN_PROGRESS: "PENDING",
  REFUND_REQUESTED: "PENDING",
  REFUND_DENIED: "PAID",
  CHARGEBACK_REQUESTED: "PENDING",
  CHARGEBACK_DISPUTE: "PENDING",
  AWAITING_CHARGEBACK_REVERSAL: "PENDING",
  DUNNING_REQUESTED: "PENDING",
  DUNNING_RECEIVED: "PAID",
  AWAITING_CREDIT_CARD_REVERSAL: "PENDING",
};

export function mapAsaasStatus(status: string): PixCharge["status"] {
  const normalized = asaasStatusMap[status];
  if (!normalized) {
    throw new ConflictException(`Status Asaas não reconhecido: ${status}`);
  }
  return normalized;
}

export function mapChargeToPaymentStatus(
  charge: PixCharge,
  event: string,
): StatusPagamento {
  if (event === "PAYMENT_REFUNDED") {
    return StatusPagamento.ESTORNADO;
  }
  if (event === "PAYMENT_REFUND_IN_PROGRESS") {
    return StatusPagamento.ESTORNO_PENDENTE;
  }
  switch (charge.status) {
    case "PENDING":
      return StatusPagamento.AGUARDANDO_PAGAMENTO;
    case "PAID":
      return StatusPagamento.PAGO;
    case "FAILED":
      return StatusPagamento.FALHOU;
    case "EXPIRED":
      return StatusPagamento.EXPIRADO;
    case "CANCELLED":
      return event === "PAYMENT_REFUNDED"
        ? StatusPagamento.ESTORNADO
        : StatusPagamento.CANCELADO;
  }
}

export function assertPaymentTransition(
  current: StatusPagamento,
  next: StatusPagamento,
): void {
  if (current === next) return;
  const allowed: Partial<Record<StatusPagamento, StatusPagamento[]>> = {
    AGUARDANDO_CRIACAO_GATEWAY: [
      StatusPagamento.AGUARDANDO_PAGAMENTO,
      StatusPagamento.PAGO,
      StatusPagamento.FALHOU,
      StatusPagamento.CANCELADO,
      StatusPagamento.EXPIRADO,
    ],
    AGUARDANDO_PAGAMENTO: [
      StatusPagamento.PAGO,
      StatusPagamento.FALHOU,
      StatusPagamento.CANCELADO,
      StatusPagamento.EXPIRADO,
      StatusPagamento.ESTORNO_PENDENTE,
      StatusPagamento.ESTORNADO,
    ],
    AGUARDANDO_CONFIRMACAO_MANUAL: [
      StatusPagamento.PAGO,
      StatusPagamento.FALHOU,
      StatusPagamento.CANCELADO,
      StatusPagamento.EXPIRADO,
    ],
    PAGO: [
      StatusPagamento.ESTORNO_PENDENTE,
      StatusPagamento.ESTORNADO,
      StatusPagamento.CANCELADO,
    ],
    ESTORNO_PENDENTE: [StatusPagamento.ESTORNADO, StatusPagamento.PAGO],
  };
  if (!allowed[current]?.includes(next)) {
    throw new ConflictException(
      `Transição de pagamento inválida: ${current} -> ${next}`,
    );
  }
}
