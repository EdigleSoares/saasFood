import { PrismaService } from "../../database/prisma.service";
import { CustomerService } from "./customer.service";

describe("CustomerService", () => {
  const tx = {
    cliente: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };
  const prisma = {
    withTenant: jest.fn(
      (_tenantId: string, operation: (transaction: typeof tx) => unknown) =>
        operation(tx),
    ),
  } as unknown as PrismaService;
  const service = new CustomerService(prisma);

  beforeEach(() => jest.clearAllMocks());

  it("lists only identified customers in the active tenant", async () => {
    tx.cliente.findMany.mockResolvedValue([]);

    await service.listCustomers("restaurant-id", {
      busca: "Ana",
      limite: 20,
    });

    expect(prisma.withTenant).toHaveBeenCalledWith(
      "restaurant-id",
      expect.any(Function),
    );
    expect(tx.cliente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          restauranteId: "restaurant-id",
          anonimizadoEm: null,
        }),
        take: 20,
      }),
    );
  });

  it("does not search phone with an empty value for non-numeric searches", async () => {
    tx.cliente.findMany.mockResolvedValue([]);

    await service.listCustomers("restaurant-id", { busca: "---" });

    expect(tx.cliente.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ nome: { contains: "---", mode: "insensitive" } }],
        }),
      }),
    );
  });
});
