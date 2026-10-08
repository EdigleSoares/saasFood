import { BadRequestException, ConflictException } from "@nestjs/common";
import { Prisma, StatusPedido, TipoEntrega } from "@prisma/client";
import {
  calculateOrderTotals,
  isOpenAt,
  validateChangeDue,
  validateOrderTransition,
} from "./order-rules";

describe("order calculations and transitions", () => {
  it("calculates line extensions, extras, subtotal, and delivery fee with Decimal", () => {
    const totals = calculateOrderTotals(
      [
        {
          quantity: 2,
          unitPrice: new Prisma.Decimal("10.00"),
          additionalTotal: new Prisma.Decimal("2.50"),
        },
        {
          quantity: 1,
          unitPrice: new Prisma.Decimal("8.90"),
          additionalTotal: new Prisma.Decimal("0"),
        },
      ],
      new Prisma.Decimal("4.50"),
    );

    expect(totals.subtotal.toFixed(2)).toBe("33.90");
    expect(totals.total.toFixed(2)).toBe("38.40");
  });

  it("rejects invalid quantities and negative prices", () => {
    expect(() =>
      calculateOrderTotals(
        [
          {
            quantity: 0,
            unitPrice: new Prisma.Decimal("10.00"),
            additionalTotal: new Prisma.Decimal("0"),
          },
        ],
        new Prisma.Decimal("0"),
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      calculateOrderTotals(
        [
          {
            quantity: 1,
            unitPrice: new Prisma.Decimal("10.00"),
            additionalTotal: new Prisma.Decimal("0"),
          },
        ],
        new Prisma.Decimal("-1.00"),
      ),
    ).toThrow(BadRequestException);
  });

  it("allows change only for cash and not below the order total", () => {
    const total = new Prisma.Decimal("25.00");
    expect(() =>
      validateChangeDue("DINHEIRO", new Prisma.Decimal("30.00"), total),
    ).not.toThrow();
    expect(() =>
      validateChangeDue("PIX_MANUAL", new Prisma.Decimal("30.00"), total),
    ).toThrow(BadRequestException);
    expect(() =>
      validateChangeDue("DINHEIRO", new Prisma.Decimal("20.00"), total),
    ).toThrow(BadRequestException);
  });

  it("allows only valid status transitions and matching fulfillment status", () => {
    expect(() =>
      validateOrderTransition(
        StatusPedido.AGUARDANDO_ACEITE,
        StatusPedido.ACEITO,
        TipoEntrega.DELIVERY,
      ),
    ).not.toThrow();
    expect(() =>
      validateOrderTransition(
        StatusPedido.EM_PREPARO,
        StatusPedido.SAIU_PARA_ENTREGA,
        TipoEntrega.DELIVERY,
      ),
    ).not.toThrow();
    expect(() =>
      validateOrderTransition(
        StatusPedido.EM_PREPARO,
        StatusPedido.SAIU_PARA_ENTREGA,
        TipoEntrega.RETIRADA,
      ),
    ).toThrow(ConflictException);
    expect(() =>
      validateOrderTransition(
        StatusPedido.CONCLUIDO,
        StatusPedido.EM_PREPARO,
        TipoEntrega.RETIRADA,
      ),
    ).toThrow(ConflictException);
  });

  it("requires a reason to cancel after the restaurant accepts", () => {
    expect(() =>
      validateOrderTransition(
        StatusPedido.ACEITO,
        StatusPedido.CANCELADO,
        TipoEntrega.RETIRADA,
      ),
    ).toThrow(BadRequestException);
    expect(() =>
      validateOrderTransition(
        StatusPedido.ACEITO,
        StatusPedido.CANCELADO,
        TipoEntrega.RETIRADA,
        "Indisponibilidade operacional",
      ),
    ).not.toThrow();
  });

  it("checks normal and overnight opening intervals in São Paulo local time", () => {
    expect(
      isOpenAt(
        [
          {
            diaSemana: "QUARTA",
            abreAs: "12:00",
            fechaAs: "14:00",
          },
        ],
        new Date("2026-10-07T16:30:00.000Z"),
      ),
    ).toBe(true);

    expect(
      isOpenAt(
        [
          {
            diaSemana: "TERCA",
            abreAs: "22:00",
            fechaAs: "02:00",
          },
        ],
        new Date("2026-10-07T04:00:00.000Z"),
      ),
    ).toBe(true);
  });
});
