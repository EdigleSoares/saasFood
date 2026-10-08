import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { ListCustomersDto } from "./dto/list-customers.dto";

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  listCustomers(restauranteId: string, query: ListCustomersDto) {
    const search = query.busca?.trim();
    const phoneDigits = search?.replace(/\D/g, "");
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.cliente.findMany({
        where: {
          restauranteId,
          anonimizadoEm: null,
          ...(search
            ? {
                OR: [
                  { nome: { contains: search, mode: "insensitive" } },
                  ...(phoneDigits
                    ? [{ telefone: { contains: phoneDigits } }]
                    : []),
                ],
              }
            : {}),
        },
        take: query.limite ?? 50,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          nome: true,
          telefone: true,
          createdAt: true,
          enderecos: {
            orderBy: [{ padrao: "desc" }, { createdAt: "desc" }],
            select: {
              id: true,
              rotulo: true,
              rua: true,
              numero: true,
              complemento: true,
              bairro: true,
              cidade: true,
              estado: true,
              padrao: true,
            },
          },
          _count: { select: { pedidos: true } },
        },
      }),
    );
  }

  async getCustomer(restauranteId: string, customerId: string) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const customer = await tx.cliente.findFirst({
        where: {
          restauranteId,
          id: customerId,
          anonimizadoEm: null,
        },
        select: {
          id: true,
          nome: true,
          telefone: true,
          createdAt: true,
          enderecos: {
            orderBy: [{ padrao: "desc" }, { createdAt: "desc" }],
          },
          pedidos: {
            select: {
              id: true,
              numeroPedido: true,
              status: true,
              valorTotal: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 20,
          },
          _count: { select: { pedidos: true } },
        },
      });
      if (!customer) {
        throw new NotFoundException("Cliente não encontrado");
      }
      return {
        ...customer,
        pedidos: customer.pedidos.map((order) => ({
          ...order,
          numeroPedido: order.numeroPedido.toString(),
        })),
      };
    });
  }
}
