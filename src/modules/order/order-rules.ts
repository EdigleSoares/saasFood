import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma, StatusPedido, TipoEntrega } from "@prisma/client";

export interface PricedOrderLine {
  quantity: number;
  unitPrice: Prisma.Decimal;
  additionalTotal: Prisma.Decimal;
}

export function calculateOrderTotals(
  lines: PricedOrderLine[],
  deliveryFee: Prisma.Decimal,
): { subtotal: Prisma.Decimal; total: Prisma.Decimal } {
  if (!lines.length || deliveryFee.isNegative()) {
    throw new BadRequestException("Itens e taxa de entrega inválidos");
  }

  const subtotal = lines.reduce((sum, line) => {
    if (
      !Number.isInteger(line.quantity) ||
      line.quantity < 1 ||
      line.unitPrice.isNegative() ||
      line.additionalTotal.isNegative()
    ) {
      throw new BadRequestException("Quantidade ou preço inválido");
    }
    return sum.plus(
      line.unitPrice.plus(line.additionalTotal).times(line.quantity),
    );
  }, new Prisma.Decimal(0));

  return { subtotal, total: subtotal.plus(deliveryFee) };
}

export function validateChangeDue(
  payment: string,
  changeFor: Prisma.Decimal | undefined,
  total: Prisma.Decimal,
): void {
  if (payment !== "DINHEIRO" && changeFor !== undefined) {
    throw new BadRequestException(
      "Troco só pode ser informado para pagamento em dinheiro",
    );
  }
  if (changeFor && changeFor.lessThan(total)) {
    throw new BadRequestException(
      "O valor para troco deve ser maior ou igual ao total do pedido",
    );
  }
}

const allowedTransitions: Record<StatusPedido, StatusPedido[]> = {
  AGUARDANDO_ACEITE: [
    StatusPedido.ACEITO,
    StatusPedido.RECUSADO,
    StatusPedido.CANCELADO,
    StatusPedido.EXPIRADO,
  ],
  ACEITO: [StatusPedido.EM_PREPARO, StatusPedido.CANCELADO],
  EM_PREPARO: [
    StatusPedido.PRONTO_RETIRADA,
    StatusPedido.SAIU_PARA_ENTREGA,
    StatusPedido.CANCELADO,
  ],
  PRONTO_RETIRADA: [StatusPedido.CONCLUIDO, StatusPedido.CANCELADO],
  SAIU_PARA_ENTREGA: [StatusPedido.CONCLUIDO, StatusPedido.CANCELADO],
  CONCLUIDO: [],
  RECUSADO: [],
  CANCELADO: [],
  EXPIRADO: [],
};

export function validateOrderTransition(
  current: StatusPedido,
  next: StatusPedido,
  type: TipoEntrega,
  reason?: string,
): void {
  if (!allowedTransitions[current].includes(next)) {
    throw new ConflictException(
      `Transição de pedido inválida: ${current} -> ${next}`,
    );
  }

  if (
    current === StatusPedido.EM_PREPARO &&
    ((type === TipoEntrega.DELIVERY && next === StatusPedido.PRONTO_RETIRADA) ||
      (type === TipoEntrega.RETIRADA &&
        next === StatusPedido.SAIU_PARA_ENTREGA))
  ) {
    throw new ConflictException(
      "O próximo status não corresponde ao tipo de entrega",
    );
  }

  if (
    next === StatusPedido.CANCELADO &&
    current !== StatusPedido.AGUARDANDO_ACEITE &&
    !reason?.trim()
  ) {
    throw new BadRequestException(
      "Informe o motivo para cancelar um pedido já aceito",
    );
  }
}

export function isOpenAt(
  intervals: Array<{
    diaSemana: string;
    abreAs: Date | string;
    fechaAs: Date | string;
  }>,
  now: Date,
): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  if (!weekday || !hour || !minute) {
    return false;
  }

  const weekdays = [
    "SUNDAY",
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
  ];
  const todayIndex = weekdays.indexOf(weekday.toUpperCase());
  const today = weekdayToDatabaseName(weekday);
  const yesterday = weekdayToDatabaseName(
    weekdays[(todayIndex + 6) % weekdays.length],
  );
  const localTime = `${hour}:${minute}`;

  return intervals.some((interval) => {
    const open = timeValue(interval.abreAs);
    const close = timeValue(interval.fechaAs);
    if (open < close) {
      return (
        interval.diaSemana === today && localTime >= open && localTime < close
      );
    }
    return (
      (interval.diaSemana === today && localTime >= open) ||
      (interval.diaSemana === yesterday && localTime < close)
    );
  });
}

function weekdayToDatabaseName(weekday: string): string {
  const names: Record<string, string> = {
    MONDAY: "SEGUNDA",
    TUESDAY: "TERCA",
    WEDNESDAY: "QUARTA",
    THURSDAY: "QUINTA",
    FRIDAY: "SEXTA",
    SATURDAY: "SABADO",
    SUNDAY: "DOMINGO",
  };
  return names[weekday.toUpperCase()] ?? "";
}

function timeValue(value: Date | string): string {
  if (typeof value === "string") {
    return value.slice(0, 5);
  }
  return `${String(value.getUTCHours()).padStart(2, "0")}:${String(
    value.getUTCMinutes(),
  ).padStart(2, "0")}`;
}
