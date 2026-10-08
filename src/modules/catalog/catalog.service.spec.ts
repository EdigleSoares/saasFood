import { NotFoundException } from "@nestjs/common";
import { Prisma, TipoProduto } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { CatalogService } from "./catalog.service";

describe("CatalogService", () => {
  const tx = {
    categoria: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    produto: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    tamanhoPizza: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    precoProdutoTamanho: {
      createMany: jest.fn(),
      deleteMany: jest.fn(),
      findMany: jest.fn(),
    },
    grupoAdicional: {
      findMany: jest.fn(),
    },
    produtoGrupoAdicional: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const prisma = {
    withTenant: jest.fn(
      (_tenantId: string, operation: (transaction: typeof tx) => unknown) =>
        operation(tx),
    ),
  } as unknown as PrismaService;
  const service = new CatalogService(prisma);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("scopes category CRUD queries to the active tenant", async () => {
    tx.categoria.create.mockResolvedValue({
      id: "category-id",
      restauranteId: "restaurant-id",
      nome: "Pizzas",
      ordem: 0,
    });

    await service.createCategory("restaurant-id", { nome: " Pizzas " });

    expect(prisma.withTenant).toHaveBeenCalledWith(
      "restaurant-id",
      expect.any(Function),
    );
    expect(tx.categoria.create).toHaveBeenCalledWith({
      data: {
        restauranteId: "restaurant-id",
        nome: "Pizzas",
        ordem: 0,
      },
    });
  });

  it("does not create a product with a category from another tenant", async () => {
    tx.categoria.findFirst.mockResolvedValue(null);

    await expect(
      service.createProduct("restaurant-id", {
        categoriaId: "foreign-category",
        tipo: TipoProduto.NORMAL,
        nome: "Pizza",
        preco: "50.00",
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(tx.produto.create).not.toHaveBeenCalled();
  });

  it("creates a normal product with decimal price in tenant scope", async () => {
    tx.produto.create.mockResolvedValue({ id: "product-id" });
    tx.produto.findUniqueOrThrow.mockResolvedValue({
      id: "product-id",
      restauranteId: "restaurant-id",
      preco: "19.90",
    });

    await service.createProduct("restaurant-id", {
      tipo: TipoProduto.NORMAL,
      nome: "Suco",
      preco: "19.90",
    });

    expect(tx.produto.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restauranteId: "restaurant-id",
          nome: "Suco",
          preco: expect.objectContaining({ d: expect.any(Array) }),
        }),
      }),
    );
    expect(tx.produto.findUniqueOrThrow).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          restauranteId_id: {
            restauranteId: "restaurant-id",
            id: "product-id",
          },
        },
      }),
    );
  });

  it("stores pizza flavor prices by size and calculates half-and-half using max", async () => {
    tx.tamanhoPizza.findMany.mockResolvedValue([
      { id: "small" },
      { id: "large" },
    ]);
    tx.produto.create.mockResolvedValue({ id: "flavor-id" });
    tx.precoProdutoTamanho.createMany.mockResolvedValue({ count: 2 });
    tx.produto.findUniqueOrThrow.mockResolvedValue({ id: "flavor-id" });

    await service.createProduct("restaurant-id", {
      tipo: TipoProduto.SABOR_PIZZA,
      nome: "Calabresa",
      precos: [
        { tamanhoId: "small", preco: "25.00" },
        { tamanhoId: "large", preco: "42.00" },
      ],
    });

    expect(tx.precoProdutoTamanho.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({
          restauranteId: "restaurant-id",
          produtoId: "flavor-id",
          tamanhoId: "large",
        }),
      ]),
    });
    expect(tx.produto.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: TipoProduto.SABOR_PIZZA,
          preco: null,
        }),
      }),
    );

    tx.tamanhoPizza.findFirst.mockResolvedValue({
      id: "large",
      quantidadeMaxSabores: 2,
    });
    tx.precoProdutoTamanho.findMany.mockResolvedValue([
      { produtoId: "flavor-a", preco: new Prisma.Decimal("32.00") },
      { produtoId: "flavor-b", preco: new Prisma.Decimal("38.50") },
    ]);

    await expect(
      service.calculateHalfAndHalfPrice(
        "restaurant-id",
        "large",
        "flavor-a",
        "flavor-b",
      ),
    ).resolves.toMatchObject({ precoUnitario: "38.50" });
    expect(tx.precoProdutoTamanho.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          restauranteId: "restaurant-id",
          tamanhoId: "large",
          produtoId: { in: ["flavor-a", "flavor-b"] },
        }),
      }),
    );
  });

  it("associates reusable additional groups with per-product selection limits", async () => {
    tx.produto.create.mockResolvedValue({ id: "product-id" });
    tx.produto.findUniqueOrThrow.mockResolvedValue({ id: "product-id" });
    tx.grupoAdicional.findMany.mockResolvedValue([{ id: "toppings-group" }]);
    tx.produtoGrupoAdicional.deleteMany.mockResolvedValue({ count: 0 });
    tx.produtoGrupoAdicional.createMany.mockResolvedValue({ count: 1 });

    await service.createProduct("restaurant-id", {
      tipo: TipoProduto.NORMAL,
      nome: "Pizza",
      preco: "40.00",
      gruposAdicionais: [
        {
          grupoId: "toppings-group",
          obrigatorio: true,
          minimo: 1,
          maximo: 3,
        },
      ],
    });

    expect(tx.grupoAdicional.findMany).toHaveBeenCalledWith({
      where: {
        restauranteId: "restaurant-id",
        id: { in: ["toppings-group"] },
        ativo: true,
      },
      select: { id: true },
    });
    expect(tx.produtoGrupoAdicional.createMany).toHaveBeenCalledWith({
      data: [
        {
          restauranteId: "restaurant-id",
          produtoId: "product-id",
          grupoId: "toppings-group",
          obrigatorio: true,
          minimo: 1,
          maximo: 3,
          ordem: 0,
        },
      ],
    });
  });

  it("rejects unavailable or foreign pizza sizes before creating a flavor", async () => {
    tx.tamanhoPizza.findMany.mockResolvedValue([]);

    await expect(
      service.createProduct("restaurant-id", {
        tipo: TipoProduto.SABOR_PIZZA,
        nome: "Calabresa",
        precos: [{ tamanhoId: "foreign-size", preco: "32.00" }],
      }),
    ).rejects.toThrow(
      "Um ou mais tamanhos não existem neste restaurante ou estão inativos",
    );
    expect(tx.produto.create).not.toHaveBeenCalled();
  });

  it("archives products rather than deleting order history references", async () => {
    tx.produto.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.archiveProduct("restaurant-id", "product-id"),
    ).resolves.toEqual({
      id: "product-id",
      ativo: false,
      disponivel: false,
    });
    expect(tx.produto.updateMany).toHaveBeenCalledWith({
      where: {
        restauranteId: "restaurant-id",
        id: "product-id",
        ativo: true,
      },
      data: { ativo: false, disponivel: false },
    });
  });
});
