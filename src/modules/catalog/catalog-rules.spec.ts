import { BadRequestException } from "@nestjs/common";
import { Prisma, TipoProduto } from "@prisma/client";
import {
  calculateHalfAndHalfPrice,
  validateAdditionalSelectionRules,
  validateProductPricing,
} from "./catalog-rules";

describe("catalog pricing and selection rules", () => {
  it("requires one non-negative fixed price for normal products", () => {
    expect(() =>
      validateProductPricing({
        tipo: TipoProduto.NORMAL,
        preco: "12.50",
      }),
    ).not.toThrow();

    expect(() =>
      validateProductPricing({
        tipo: TipoProduto.NORMAL,
        preco: "-1.00",
      }),
    ).toThrow(BadRequestException);
    expect(() => validateProductPricing({ tipo: TipoProduto.NORMAL })).toThrow(
      BadRequestException,
    );
  });

  it("requires distinct size prices for pizza flavors", () => {
    expect(() =>
      validateProductPricing({
        tipo: TipoProduto.SABOR_PIZZA,
        precos: [
          { tamanhoId: "small", preco: "25.00" },
          { tamanhoId: "large", preco: "42.90" },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateProductPricing({
        tipo: TipoProduto.SABOR_PIZZA,
        preco: "25.00",
        precos: [{ tamanhoId: "small", preco: "25.00" }],
      }),
    ).toThrow(BadRequestException);
    expect(() =>
      validateProductPricing({
        tipo: TipoProduto.SABOR_PIZZA,
        precos: [
          { tamanhoId: "small", preco: "25.00" },
          { tamanhoId: "small", preco: "28.00" },
        ],
      }),
    ).toThrow(BadRequestException);
  });

  it("charges the higher flavor price for a half-and-half pizza", () => {
    expect(calculateHalfAndHalfPrice("31.90", "42.50", 2).toFixed(2)).toBe(
      "42.50",
    );
    expect(
      calculateHalfAndHalfPrice(
        new Prisma.Decimal("47.00"),
        new Prisma.Decimal("38.90"),
        2,
      ).toFixed(2),
    ).toBe("47.00");
  });

  it("rejects half-and-half for sizes limited to one flavor", () => {
    expect(() => calculateHalfAndHalfPrice("20.00", "25.00", 1)).toThrow(
      BadRequestException,
    );
  });

  it("validates required and optional additional-group limits", () => {
    expect(() => validateAdditionalSelectionRules(true, 1, 2)).not.toThrow();
    expect(() => validateAdditionalSelectionRules(false, 0, 3)).not.toThrow();
    expect(() => validateAdditionalSelectionRules(true, 0, 2)).toThrow(
      BadRequestException,
    );
    expect(() => validateAdditionalSelectionRules(false, 3, 2)).toThrow(
      BadRequestException,
    );
    expect(() => validateAdditionalSelectionRules(false, -1, 2)).toThrow(
      BadRequestException,
    );
  });
});
