import { BadRequestException } from "@nestjs/common";
import { Prisma, TipoProduto } from "@prisma/client";

export interface ProductPricingInput {
  tipo: TipoProduto;
  preco?: string;
  precos?: Array<{ tamanhoId: string; preco: string }>;
}

export function validateProductPricing(input: ProductPricingInput): void {
  if (input.tipo === TipoProduto.NORMAL) {
    if (input.preco === undefined || input.precos?.length) {
      throw new BadRequestException(
        "Produto normal exige preço único e não aceita preços por tamanho",
      );
    }
    assertNonNegativeMoney(input.preco, "preco");
    return;
  }

  if (input.preco !== undefined || !input.precos?.length) {
    throw new BadRequestException(
      "Sabor de pizza exige preço para pelo menos um tamanho e não aceita preço único",
    );
  }

  const sizeIds = new Set<string>();
  for (const entry of input.precos) {
    assertNonNegativeMoney(entry.preco, "precos.preco");
    if (sizeIds.has(entry.tamanhoId)) {
      throw new BadRequestException("Tamanho de pizza duplicado nos preços");
    }
    sizeIds.add(entry.tamanhoId);
  }
}

export function validateAdditionalSelectionRules(
  required: boolean,
  minimum: number,
  maximum: number,
): void {
  if (
    !Number.isInteger(minimum) ||
    !Number.isInteger(maximum) ||
    minimum < 0 ||
    maximum < minimum ||
    (required && minimum === 0)
  ) {
    throw new BadRequestException(
      "Regras inválidas: mínimo e máximo devem ser consistentes; grupos obrigatórios exigem mínimo maior que zero",
    );
  }
}

export function calculateHalfAndHalfPrice(
  firstFlavorPrice: string | Prisma.Decimal,
  secondFlavorPrice: string | Prisma.Decimal,
  maxFlavors: number,
): Prisma.Decimal {
  if (maxFlavors < 2) {
    throw new BadRequestException(
      "O tamanho selecionado não permite pizza meio a meio",
    );
  }

  const first = toNonNegativeDecimal(
    firstFlavorPrice,
    "preço do primeiro sabor",
  );
  const second = toNonNegativeDecimal(
    secondFlavorPrice,
    "preço do segundo sabor",
  );
  return Prisma.Decimal.max(first, second);
}

function assertNonNegativeMoney(value: string, field: string): void {
  toNonNegativeDecimal(value, field);
}

function toNonNegativeDecimal(
  value: string | Prisma.Decimal,
  field: string,
): Prisma.Decimal {
  let decimal: Prisma.Decimal;
  try {
    decimal = new Prisma.Decimal(value);
  } catch {
    throw new BadRequestException(`${field} inválido`);
  }

  if (!decimal.isFinite() || decimal.isNegative()) {
    throw new BadRequestException(`${field} deve ser um valor não negativo`);
  }
  if (decimal.decimalPlaces() > 2) {
    throw new BadRequestException(
      `${field} aceita no máximo duas casas decimais`,
    );
  }
  return decimal;
}
