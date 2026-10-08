import { BadRequestException } from "@nestjs/common";
import {
  FormaPagamento,
  OrigemPedido,
  Prisma,
  StatusPedido,
  TipoEntrega,
  TipoProduto,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { PaymentService } from "../payment/payment.service";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrderService } from "./order.service";

describe("OrderService", () => {
  const tx = {
    pedido: {
      findFirst: jest.fn(),
      create: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
    },
    configuracaoRestaurante: {
      findUnique: jest.fn(),
    },
    configuracaoPixManual: {
      findUnique: jest.fn(),
    },
    credencialGateway: {
      findFirst: jest.fn(),
    },
    horarioFuncionamento: {
      findMany: jest.fn(),
    },
    bairroEntrega: {
      findFirst: jest.fn(),
    },
    produto: {
      findFirst: jest.fn(),
    },
    cliente: {
      upsert: jest.fn(),
    },
    contadorPedido: {
      upsert: jest.fn(),
    },
    eventoStatusPedido: {
      create: jest.fn(),
    },
    outboxEvento: {
      create: jest.fn(),
    },
  };
  const prisma = {
    withTenant: jest.fn(
      (_tenantId: string, operation: (transaction: typeof tx) => unknown) =>
        operation(tx),
    ),
  } as unknown as PrismaService;
  const createAsaasCharge = jest.fn();
  const payments = { createAsaasCharge } as unknown as PaymentService;
  const service = new OrderService(prisma, payments);

  const settings = {
    deliveryHabilitado: true,
    retiradaHabilitada: true,
    aceitarPixManual: false,
    aceitarPixAsaas: false,
    aceitarDinheiro: true,
    aceitarCartaoCredito: true,
    aceitarCartaoDebito: true,
    prazoAceiteMinutos: 10,
    prazoPagamentoMinutos: 15,
  };

  const input: CreateOrderDto = {
    nomeCliente: "  Ana Lima ",
    telefoneCliente: "(11) 99999-0000",
    tipoEntrega: TipoEntrega.DELIVERY,
    endereco: {
      bairroId: "neighborhood-id",
      rua: "Rua das Flores",
      numero: "42",
      complemento: "Casa 2",
      referencia: "Portão azul",
      cep: "01000-000",
      cidade: "São Paulo",
      estado: "sp",
    },
    formaPagamento: FormaPagamento.DINHEIRO,
    trocoPara: "40.00",
    itens: [
      {
        produtoId: "product-id",
        quantidade: 2,
        gruposAdicionais: [
          {
            grupoId: "extra-group",
            itens: [{ itemAdicionalId: "cheese-edge", quantidade: 1 }],
          },
        ],
      },
    ],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.pedido.findFirst.mockResolvedValue(null);
    tx.configuracaoRestaurante.findUnique.mockResolvedValue(settings);
    tx.configuracaoPixManual.findUnique.mockResolvedValue(null);
    tx.credencialGateway.findFirst.mockResolvedValue(null);
    tx.bairroEntrega.findFirst.mockResolvedValue({
      id: "neighborhood-id",
      nome: "Centro",
      taxaEntrega: new Prisma.Decimal("4.50"),
    });
    tx.produto.findFirst.mockResolvedValue({
      id: "product-id",
      nome: "Pizza grande",
      descricao: "Massa artesanal",
      tipo: TipoProduto.NORMAL,
      preco: new Prisma.Decimal("10.00"),
      precos: [],
      gruposAdicionais: [
        {
          grupoId: "extra-group",
          obrigatorio: true,
          minimo: 1,
          maximo: 2,
          grupo: {
            ativo: true,
            itens: [
              {
                id: "cheese-edge",
                nome: "Borda de queijo",
                preco: new Prisma.Decimal("2.50"),
                disponivel: true,
              },
            ],
          },
        },
      ],
    });
    tx.cliente.upsert.mockResolvedValue({ id: "customer-id" });
    tx.contadorPedido.upsert.mockResolvedValue({ proximoNumero: 2n });
    tx.pedido.create.mockImplementation(({ data }) =>
      Promise.resolve({
        id: "order-id",
        ...data,
        itens: data.itens.create,
        pagamentos: data.pagamentos.create,
      }),
    );
    tx.outboxEvento.create.mockResolvedValue({});
  });

  it("creates a tenant-scoped order with amount and checkout-time snapshots", async () => {
    const result = await service.createPosOrder(
      "restaurant-id",
      "operator-id",
      input,
      "pos-order-001",
    );

    expect(prisma.withTenant).toHaveBeenCalledWith(
      "restaurant-id",
      expect.any(Function),
    );
    const createArgs = tx.pedido.create.mock.calls[0][0];
    expect(createArgs.data).toMatchObject({
      restauranteId: "restaurant-id",
      origem: OrigemPedido.PDV,
      criadoPorUsuarioId: "operator-id",
      clienteId: "customer-id",
      nomeContatoSnapshot: "Ana Lima",
      telefoneSnapshot: "11999990000",
      enderecoRuaSnapshot: "Rua das Flores",
      enderecoNumeroSnapshot: "42",
      bairroSnapshot: "Centro",
      enderecoEstadoSnapshot: "SP",
      numeroPedido: 1n,
      status: StatusPedido.ACEITO,
      idempotencyKey: "pos-order-001",
    });
    expect(createArgs.data.subtotal.toFixed(2)).toBe("25.00");
    expect(createArgs.data.taxaEntrega.toFixed(2)).toBe("4.50");
    expect(createArgs.data.valorTotal.toFixed(2)).toBe("29.50");
    expect(createArgs.data.itens.create[0]).toMatchObject({
      nomeProdutoSnapshot: "Pizza grande",
      descricaoSnapshot: "Massa artesanal",
      quantidade: 2,
      observacao: undefined,
    });
    expect(createArgs.data.itens.create[0].precoUnitario.toFixed(2)).toBe(
      "10.00",
    );
    expect(createArgs.data.itens.create[0].totalLinha.toFixed(2)).toBe("25.00");
    expect(createArgs.data.itens.create[0].adicionais.create[0]).toMatchObject({
      itemAdicionalId: "cheese-edge",
      nomeSnapshot: "Borda de queijo",
      quantidade: 1,
    });
    expect(result.order.id).toBe("order-id");
  });

  it("rejects a second use of an idempotency key with another payload", async () => {
    tx.pedido.findFirst.mockResolvedValue({
      id: "existing-order",
      payloadHash: "different-payload-hash",
    });

    await expect(
      service.createPublicOrder("restaurant-id", input, "checkout-0001"),
    ).rejects.toThrow("Idempotency-Key já utilizado com conteúdo diferente");
    expect(tx.configuracaoRestaurante.findUnique).not.toHaveBeenCalled();
  });

  it("requires an idempotency key for public checkout", async () => {
    await expect(
      service.createPublicOrder("restaurant-id", input, ""),
    ).rejects.toThrow("Header Idempotency-Key é obrigatório");
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });

  it("rejects a delivery neighborhood outside the tenant", async () => {
    tx.bairroEntrega.findFirst.mockResolvedValue(null);

    await expect(
      service.createPosOrder("restaurant-id", "operator-id", input),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.pedido.create).not.toHaveBeenCalled();
  });

  it("does not accept a client-provided total or product price", async () => {
    const forgedInput: CreateOrderDto = Object.assign(
      new CreateOrderDto(),
      input,
      {
        total: "0.01",
        itens: [
          Object.assign({}, input.itens[0], {
            preco: "0.01",
          }),
        ],
      },
    );

    await service.createPosOrder("restaurant-id", "operator-id", forgedInput);
    const createArgs = tx.pedido.create.mock.calls[0][0];
    expect(createArgs.data.valorTotal.toFixed(2)).toBe("29.50");
    expect(createArgs.data.itens.create[0].precoUnitario.toFixed(2)).toBe(
      "10.00",
    );
  });

  it("records legal transitions with audit and outbox events", async () => {
    tx.pedido.findFirst.mockResolvedValue({
      id: "order-id",
      status: StatusPedido.AGUARDANDO_ACEITE,
      tipoEntrega: TipoEntrega.DELIVERY,
    });
    tx.pedido.updateMany.mockResolvedValue({ count: 1 });
    tx.eventoStatusPedido.create.mockResolvedValue({});
    tx.outboxEvento.create.mockResolvedValue({});
    tx.pedido.findUniqueOrThrow.mockResolvedValue({
      id: "order-id",
      status: StatusPedido.ACEITO,
    });

    await expect(
      service.transitionStatus(
        "restaurant-id",
        "order-id",
        StatusPedido.ACEITO,
        "operator-id",
      ),
    ).resolves.toMatchObject({ status: StatusPedido.ACEITO });
    expect(tx.pedido.updateMany).toHaveBeenCalledWith({
      where: {
        restauranteId: "restaurant-id",
        id: "order-id",
        status: StatusPedido.AGUARDANDO_ACEITE,
      },
      data: { status: StatusPedido.ACEITO },
    });
    expect(tx.eventoStatusPedido.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        restauranteId: "restaurant-id",
        pedidoId: "order-id",
        statusAnterior: StatusPedido.AGUARDANDO_ACEITE,
        statusNovo: StatusPedido.ACEITO,
      }),
    });
    expect(tx.outboxEvento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tipo: "STATUS_PEDIDO_ATUALIZADO",
        }),
      }),
    );
  });

  it("creates the Asaas charge only after an Asaas order is accepted", async () => {
    tx.pedido.findFirst.mockResolvedValue({
      id: "order-id",
      status: StatusPedido.AGUARDANDO_ACEITE,
      tipoEntrega: TipoEntrega.DELIVERY,
    });
    tx.pedido.updateMany.mockResolvedValue({ count: 1 });
    tx.eventoStatusPedido.create.mockResolvedValue({});
    tx.outboxEvento.create.mockResolvedValue({});
    tx.pedido.findUniqueOrThrow.mockResolvedValue({
      id: "order-id",
      status: StatusPedido.ACEITO,
      formaPagamento: FormaPagamento.PIX_ASAAS,
    });
    createAsaasCharge.mockResolvedValue({
      status: "AGUARDANDO_PAGAMENTO",
      copiaECola: "pix-copy",
    });

    await expect(
      service.transitionStatus(
        "restaurant-id",
        "order-id",
        StatusPedido.ACEITO,
        "operator-id",
      ),
    ).resolves.toMatchObject({
      paymentInstructions: { copiaECola: "pix-copy" },
    });
    expect(createAsaasCharge).toHaveBeenCalledWith("restaurant-id", "order-id");
  });
});
