import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, TipoProduto } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import {
  calculateHalfAndHalfPrice,
  validateAdditionalSelectionRules,
  validateProductPricing,
} from "./catalog-rules";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import {
  CreateProductDto,
  ProductAdditionalRuleDto,
  ProductSizePriceDto,
  UpdateProductDto,
} from "./dto/product.dto";
import { CreatePizzaSizeDto, UpdatePizzaSizeDto } from "./dto/pizza-size.dto";
import {
  CreateAdditionalGroupDto,
  CreateAdditionalItemDto,
  UpdateAdditionalGroupDto,
  UpdateAdditionalItemDto,
} from "./dto/additional.dto";

const productInclude = {
  categoria: true,
  precos: {
    include: { tamanho: true },
    orderBy: { tamanho: { ordem: "asc" as const } },
  },
  gruposAdicionais: {
    orderBy: { ordem: "asc" as const },
    include: {
      grupo: {
        include: {
          itens: {
            where: { disponivel: true },
            orderBy: { ordem: "asc" as const },
          },
        },
      },
    },
  },
};

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  listCategories(restauranteId: string) {
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.categoria.findMany({
        where: { restauranteId },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      }),
    );
  }

  createCategory(restauranteId: string, input: CreateCategoryDto) {
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.categoria.create({
        data: {
          restauranteId,
          nome: input.nome.trim(),
          ordem: input.ordem ?? 0,
        },
      }),
    );
  }

  async updateCategory(
    restauranteId: string,
    categoryId: string,
    input: UpdateCategoryDto,
  ) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      await this.requireCategory(tx, restauranteId, categoryId);
      return tx.categoria.update({
        where: { restauranteId_id: { restauranteId, id: categoryId } },
        data: {
          ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}),
          ...(input.ordem !== undefined ? { ordem: input.ordem } : {}),
          ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
        },
      });
    });
  }

  async archiveCategory(restauranteId: string, categoryId: string) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      await this.requireCategory(tx, restauranteId, categoryId);
      await tx.produto.updateMany({
        where: { restauranteId, categoriaId: categoryId },
        data: { categoriaId: null },
      });
      return tx.categoria.update({
        where: { restauranteId_id: { restauranteId, id: categoryId } },
        data: { ativo: false },
      });
    });
  }

  listProducts(restauranteId: string, includeInactive = false) {
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.produto.findMany({
        where: {
          restauranteId,
          ...(includeInactive ? {} : { ativo: true }),
        },
        include: productInclude,
        orderBy: [{ createdAt: "desc" }],
      }),
    );
  }

  async getProduct(restauranteId: string, productId: string) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const product = await tx.produto.findFirst({
        where: { restauranteId, id: productId },
        include: productInclude,
      });
      if (!product) {
        throw new NotFoundException("Produto não encontrado");
      }
      return product;
    });
  }

  async createProduct(restauranteId: string, input: CreateProductDto) {
    validateProductPricing(input);
    this.validateUniqueRules(input.gruposAdicionais ?? []);

    return this.prisma.withTenant(restauranteId, async (tx) => {
      if (input.categoriaId) {
        await this.requireCategory(tx, restauranteId, input.categoriaId, true);
      }
      if (input.tipo === TipoProduto.SABOR_PIZZA) {
        await this.requireActiveSizes(tx, restauranteId, input.precos ?? []);
      }

      const product = await tx.produto.create({
        data: {
          restauranteId,
          categoriaId: input.categoriaId,
          tipo: input.tipo,
          nome: input.nome.trim(),
          descricao: input.descricao?.trim(),
          imagemKey: input.imagemKey?.trim(),
          preco:
            input.tipo === TipoProduto.NORMAL
              ? new Prisma.Decimal(input.preco!)
              : null,
        },
        select: { id: true },
      });

      if (input.precos?.length) {
        await tx.precoProdutoTamanho.createMany({
          data: input.precos.map((price) => ({
            restauranteId,
            produtoId: product.id,
            tamanhoId: price.tamanhoId,
            preco: new Prisma.Decimal(price.preco),
          })),
        });
      }
      if (input.gruposAdicionais?.length) {
        await this.replaceProductAdditionalGroups(
          tx,
          restauranteId,
          product.id,
          input.gruposAdicionais,
        );
      }

      return tx.produto.findUniqueOrThrow({
        where: { restauranteId_id: { restauranteId, id: product.id } },
        include: productInclude,
      });
    });
  }

  async updateProduct(
    restauranteId: string,
    productId: string,
    input: UpdateProductDto,
  ) {
    this.validateUniqueRules(input.gruposAdicionais ?? []);
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const existing = await tx.produto.findFirst({
        where: { restauranteId, id: productId, ativo: true },
        include: { precos: true },
      });
      if (!existing) {
        throw new NotFoundException("Produto ativo não encontrado");
      }

      if (input.categoriaId) {
        await this.requireCategory(tx, restauranteId, input.categoriaId, true);
      }

      if (existing.tipo === TipoProduto.NORMAL) {
        if (input.precos !== undefined) {
          throw new BadRequestException(
            "Produto normal não aceita preços por tamanho",
          );
        }
      } else {
        if (input.preco !== undefined) {
          throw new BadRequestException(
            "Sabores de pizza usam preços por tamanho",
          );
        }
        if (input.precos !== undefined) {
          validateProductPricing({
            tipo: TipoProduto.SABOR_PIZZA,
            precos: input.precos,
          });
          await this.requireActiveSizes(tx, restauranteId, input.precos);
        } else if (existing.precos.length === 0) {
          throw new BadRequestException(
            "Sabor de pizza precisa ter preço para pelo menos um tamanho",
          );
        }
      }

      await tx.produto.update({
        where: { restauranteId_id: { restauranteId, id: productId } },
        data: {
          ...(input.categoriaId !== undefined
            ? { categoriaId: input.categoriaId }
            : {}),
          ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}),
          ...(input.descricao !== undefined
            ? { descricao: input.descricao?.trim() ?? null }
            : {}),
          ...(input.imagemKey !== undefined
            ? { imagemKey: input.imagemKey?.trim() ?? null }
            : {}),
          ...(input.preco !== undefined
            ? { preco: new Prisma.Decimal(input.preco) }
            : {}),
          ...(input.disponivel !== undefined
            ? { disponivel: input.disponivel }
            : {}),
          ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
        },
      });

      if (input.precos !== undefined) {
        await tx.precoProdutoTamanho.deleteMany({
          where: { restauranteId, produtoId: productId },
        });
        await tx.precoProdutoTamanho.createMany({
          data: input.precos.map((price) => ({
            restauranteId,
            produtoId: productId,
            tamanhoId: price.tamanhoId,
            preco: new Prisma.Decimal(price.preco),
          })),
        });
      }
      if (input.gruposAdicionais !== undefined) {
        await this.replaceProductAdditionalGroups(
          tx,
          restauranteId,
          productId,
          input.gruposAdicionais,
        );
      }

      return tx.produto.findUniqueOrThrow({
        where: { restauranteId_id: { restauranteId, id: productId } },
        include: productInclude,
      });
    });
  }

  archiveProduct(restauranteId: string, productId: string) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const result = await tx.produto.updateMany({
        where: { restauranteId, id: productId, ativo: true },
        data: { ativo: false, disponivel: false },
      });
      if (result.count !== 1) {
        throw new NotFoundException("Produto ativo não encontrado");
      }
      return { id: productId, ativo: false, disponivel: false };
    });
  }

  async setProductAvailability(
    restauranteId: string,
    productId: string,
    disponivel: boolean,
  ) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const result = await tx.produto.updateMany({
        where: { restauranteId, id: productId, ativo: true },
        data: { disponivel },
      });
      if (result.count !== 1) {
        throw new NotFoundException("Produto ativo não encontrado");
      }
      return { id: productId, disponivel };
    });
  }

  listPizzaSizes(restauranteId: string) {
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.tamanhoPizza.findMany({
        where: { restauranteId },
        orderBy: [{ ordem: "asc" }, { nome: "asc" }],
      }),
    );
  }

  createPizzaSize(restauranteId: string, input: CreatePizzaSizeDto) {
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.tamanhoPizza.create({
        data: {
          restauranteId,
          nome: input.nome.trim(),
          quantidadeMaxSabores: input.quantidadeMaxSabores ?? 2,
          ordem: input.ordem ?? 0,
        },
      }),
    );
  }

  async updatePizzaSize(
    restauranteId: string,
    sizeId: string,
    input: UpdatePizzaSizeDto,
  ) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const result = await tx.tamanhoPizza.updateMany({
        where: { restauranteId, id: sizeId },
        data: {
          ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}),
          ...(input.quantidadeMaxSabores !== undefined
            ? { quantidadeMaxSabores: input.quantidadeMaxSabores }
            : {}),
          ...(input.ordem !== undefined ? { ordem: input.ordem } : {}),
          ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
        },
      });
      if (result.count !== 1) {
        throw new NotFoundException("Tamanho não encontrado");
      }
      return tx.tamanhoPizza.findUniqueOrThrow({
        where: { restauranteId_id: { restauranteId, id: sizeId } },
      });
    });
  }

  listAdditionalGroups(restauranteId: string) {
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.grupoAdicional.findMany({
        where: { restauranteId },
        include: {
          itens: { orderBy: [{ ordem: "asc" }, { nome: "asc" }] },
        },
        orderBy: { nome: "asc" },
      }),
    );
  }

  createAdditionalGroup(
    restauranteId: string,
    input: CreateAdditionalGroupDto,
  ) {
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.grupoAdicional.create({
        data: {
          restauranteId,
          nome: input.nome.trim(),
          descricao: input.descricao?.trim(),
        },
      }),
    );
  }

  async updateAdditionalGroup(
    restauranteId: string,
    groupId: string,
    input: UpdateAdditionalGroupDto,
  ) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const result = await tx.grupoAdicional.updateMany({
        where: { restauranteId, id: groupId },
        data: {
          ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}),
          ...(input.descricao !== undefined
            ? { descricao: input.descricao?.trim() ?? null }
            : {}),
          ...(input.ativo !== undefined ? { ativo: input.ativo } : {}),
        },
      });
      if (result.count !== 1) {
        throw new NotFoundException("Grupo de adicionais não encontrado");
      }
      return tx.grupoAdicional.findUniqueOrThrow({
        where: { restauranteId_id: { restauranteId, id: groupId } },
      });
    });
  }

  createAdditionalItem(
    restauranteId: string,
    groupId: string,
    input: CreateAdditionalItemDto,
  ) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const group = await tx.grupoAdicional.findFirst({
        where: { restauranteId, id: groupId, ativo: true },
        select: { id: true },
      });
      if (!group) {
        throw new NotFoundException("Grupo de adicionais ativo não encontrado");
      }
      return tx.itemAdicional.create({
        data: {
          restauranteId,
          grupoId: groupId,
          nome: input.nome.trim(),
          preco: new Prisma.Decimal(input.preco ?? "0"),
          ordem: input.ordem ?? 0,
        },
      });
    });
  }

  async updateAdditionalItem(
    restauranteId: string,
    itemId: string,
    input: UpdateAdditionalItemDto,
  ) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const result = await tx.itemAdicional.updateMany({
        where: { restauranteId, id: itemId },
        data: {
          ...(input.nome !== undefined ? { nome: input.nome.trim() } : {}),
          ...(input.preco !== undefined
            ? { preco: new Prisma.Decimal(input.preco) }
            : {}),
          ...(input.disponivel !== undefined
            ? { disponivel: input.disponivel }
            : {}),
          ...(input.ordem !== undefined ? { ordem: input.ordem } : {}),
        },
      });
      if (result.count !== 1) {
        throw new NotFoundException("Adicional não encontrado");
      }
      return tx.itemAdicional.findUniqueOrThrow({
        where: { restauranteId_id: { restauranteId, id: itemId } },
      });
    });
  }

  calculateHalfAndHalfPrice(
    restauranteId: string,
    sizeId: string,
    firstFlavorId: string,
    secondFlavorId: string,
  ) {
    if (firstFlavorId === secondFlavorId) {
      throw new BadRequestException(
        "Os sabores da pizza meio a meio devem ser diferentes",
      );
    }

    return this.prisma.withTenant(restauranteId, async (tx) => {
      const size = await tx.tamanhoPizza.findFirst({
        where: { restauranteId, id: sizeId, ativo: true },
      });
      if (!size) {
        throw new NotFoundException("Tamanho ativo não encontrado");
      }
      if (size.quantidadeMaxSabores < 2) {
        throw new BadRequestException(
          "O tamanho selecionado não permite pizza meio a meio",
        );
      }

      const prices = await tx.precoProdutoTamanho.findMany({
        where: {
          restauranteId,
          tamanhoId: sizeId,
          produtoId: { in: [firstFlavorId, secondFlavorId] },
          produto: {
            tipo: TipoProduto.SABOR_PIZZA,
            disponivel: true,
            ativo: true,
          },
        },
        select: { produtoId: true, preco: true },
      });
      const first = prices.find((price) => price.produtoId === firstFlavorId);
      const second = prices.find((price) => price.produtoId === secondFlavorId);
      if (!first || !second) {
        throw new BadRequestException(
          "Os dois sabores devem estar disponíveis e ter preço para o tamanho selecionado",
        );
      }

      return {
        tamanhoId: sizeId,
        sabor1Id: firstFlavorId,
        sabor2Id: secondFlavorId,
        precoUnitario: calculateHalfAndHalfPrice(
          first.preco,
          second.preco,
          size.quantidadeMaxSabores,
        ).toFixed(2),
      };
    });
  }

  private async requireCategory(
    tx: Prisma.TransactionClient,
    restauranteId: string,
    categoryId: string,
    active = false,
  ) {
    const category = await tx.categoria.findFirst({
      where: {
        restauranteId,
        id: categoryId,
        ...(active ? { ativo: true } : {}),
      },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException(
        active ? "Categoria ativa não encontrada" : "Categoria não encontrada",
      );
    }
  }

  private async requireActiveSizes(
    tx: Prisma.TransactionClient,
    restauranteId: string,
    prices: ProductSizePriceDto[],
  ) {
    const ids = [...new Set(prices.map((price) => price.tamanhoId))];
    const sizes = await tx.tamanhoPizza.findMany({
      where: { restauranteId, id: { in: ids }, ativo: true },
      select: { id: true },
    });
    if (sizes.length !== ids.length) {
      throw new BadRequestException(
        "Um ou mais tamanhos não existem neste restaurante ou estão inativos",
      );
    }
  }

  private validateUniqueRules(rules: ProductAdditionalRuleDto[]) {
    const groupIds = new Set<string>();
    for (const rule of rules) {
      if (groupIds.has(rule.grupoId)) {
        throw new BadRequestException(
          "O mesmo grupo de adicionais não pode ser associado duas vezes",
        );
      }
      groupIds.add(rule.grupoId);
      const required =
        rule.obrigatorio ?? (rule.minimo !== undefined && rule.minimo > 0);
      const minimum = rule.minimo ?? (required ? 1 : 0);
      const maximum = rule.maximo ?? Math.max(minimum, 1);
      validateAdditionalSelectionRules(required, minimum, maximum);
    }
  }

  private async replaceProductAdditionalGroups(
    tx: Prisma.TransactionClient,
    restauranteId: string,
    productId: string,
    rules: ProductAdditionalRuleDto[],
  ) {
    const groupIds = rules.map((rule) => rule.grupoId);
    const existingGroups = await tx.grupoAdicional.findMany({
      where: { restauranteId, id: { in: groupIds }, ativo: true },
      select: { id: true },
    });
    if (existingGroups.length !== groupIds.length) {
      throw new BadRequestException(
        "Um ou mais grupos não existem neste restaurante ou estão inativos",
      );
    }

    await tx.produtoGrupoAdicional.deleteMany({
      where: { restauranteId, produtoId: productId },
    });
    if (!rules.length) {
      return;
    }
    await tx.produtoGrupoAdicional.createMany({
      data: rules.map((rule) => {
        const obrigatorio =
          rule.obrigatorio ?? (rule.minimo !== undefined && rule.minimo > 0);
        const minimo = rule.minimo ?? (obrigatorio ? 1 : 0);
        return {
          restauranteId,
          produtoId: productId,
          grupoId: rule.grupoId,
          obrigatorio,
          minimo,
          maximo: rule.maximo ?? Math.max(minimo, 1),
          ordem: rule.ordem ?? 0,
        };
      }),
    });
  }
}
