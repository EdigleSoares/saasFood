import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  FormaPagamento,
  OrigemPedido,
  Prisma,
  ProvedorPagamento,
  StatusPagamento,
  StatusPedido,
  TipoEntrega,
  TipoProduto,
  TipoAtorEvento,
} from "@prisma/client";
import { createHash, randomBytes } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import { PaymentService } from "../payment/payment.service";
import { CreateOrderDto, ListOrdersQueryDto } from "./dto/create-order.dto";
import {
  calculateOrderTotals,
  isOpenAt,
  validateChangeDue,
  validateOrderTransition,
} from "./order-rules";

interface CreateOrderOptions {
  origem: OrigemPedido;
  criadoPorUsuarioId?: string;
  idempotencyKey?: string;
}

interface PreparedAdditional {
  itemAdicionalId: string;
  nome: string;
  quantidade: number;
  preco: Prisma.Decimal;
}

interface PreparedOrderItem {
  input: CreateOrderDto["itens"][number];
  productId: string;
  name: string;
  description: string | null;
  sizeId: string | null;
  sizeName: string | null;
  flavor1Id: string | null;
  flavor1Name: string | null;
  flavor1Price: Prisma.Decimal | null;
  flavor2Id: string | null;
  flavor2Name: string | null;
  flavor2Price: Prisma.Decimal | null;
  unitPrice: Prisma.Decimal;
  extras: PreparedAdditional[];
  extraUnitTotal: Prisma.Decimal;
}

const orderDetailsInclude = {
  itens: { include: { adicionais: true } },
  pagamentos: {
    select: {
      id: true,
      forma: true,
      status: true,
      valor: true,
      moeda: true,
      expiraEm: true,
      pagoEm: true,
    },
  },
};

@Injectable()
export class OrderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payments: PaymentService,
  ) {}

  async createPublicOrder(
    restauranteId: string,
    input: CreateOrderDto,
    idempotencyKey: string,
  ) {
    return this.createOrder(restauranteId, input, {
      origem: OrigemPedido.WEB,
      idempotencyKey,
    });
  }

  async createPosOrder(
    restauranteId: string,
    criadoPorUsuarioId: string,
    input: CreateOrderDto,
    idempotencyKey?: string,
  ) {
    return this.createOrder(restauranteId, input, {
      origem: OrigemPedido.PDV,
      criadoPorUsuarioId,
      idempotencyKey,
    });
  }

  listOrders(restauranteId: string, query: ListOrdersQueryDto) {
    const take = query.limite ?? 50;
    return this.prisma.withTenant(restauranteId, (tx) =>
      tx.pedido.findMany({
        where: {
          restauranteId,
          ...(query.status ? { status: query.status as StatusPedido } : {}),
        },
        take,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: orderDetailsInclude,
      }),
    );
  }

  async getOrder(restauranteId: string, orderId: string) {
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const order = await tx.pedido.findFirst({
        where: { restauranteId, id: orderId },
        include: orderDetailsInclude,
      });
      if (!order) {
        throw new NotFoundException("Pedido não encontrado");
      }
      return order;
    });
  }

  async getPublicTracking(restauranteId: string, trackingToken: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(trackingToken)) {
      throw new NotFoundException("Acompanhamento não encontrado");
    }
    const tokenHash = this.hash(trackingToken);
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const order = await tx.pedido.findFirst({
        where: { restauranteId, trackingTokenHash: tokenHash },
        select: {
          id: true,
          numeroPedido: true,
          status: true,
          tipoEntrega: true,
          createdAt: true,
          updatedAt: true,
          itens: {
            select: {
              nomeProdutoSnapshot: true,
              sabor1Snapshot: true,
              sabor2Snapshot: true,
              tamanhoSnapshot: true,
              quantidade: true,
              precoUnitario: true,
              totalLinha: true,
            },
          },
        },
      });
      if (!order) {
        throw new NotFoundException("Acompanhamento não encontrado");
      }
      return {
        ...order,
        numeroPedido: order.numeroPedido.toString(),
      };
    });
  }

  async cancelPublicOrder(restauranteId: string, trackingToken: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(trackingToken)) {
      throw new NotFoundException("Pedido não encontrado");
    }
    const tokenHash = this.hash(trackingToken);
    return this.prisma.withTenant(restauranteId, async (tx) => {
      const order = await tx.pedido.findFirst({
        where: { restauranteId, trackingTokenHash: tokenHash },
        select: { id: true, status: true },
      });
      if (!order) {
        throw new NotFoundException("Pedido não encontrado");
      }
      if (order.status !== StatusPedido.AGUARDANDO_ACEITE) {
        throw new ConflictException(
          "O cliente só pode cancelar enquanto o pedido aguarda aceite",
        );
      }
      return this.transitionInTransaction(
        tx,
        restauranteId,
        order.id,
        StatusPedido.CANCELADO,
        undefined,
        "Cancelamento solicitado pelo cliente",
      );
    });
  }

  async transitionStatus(
    restauranteId: string,
    orderId: string,
    nextStatus: StatusPedido,
    usuarioId: string,
    reason?: string,
  ) {
    const order = await this.prisma.withTenant(restauranteId, (tx) =>
      this.transitionInTransaction(
        tx,
        restauranteId,
        orderId,
        nextStatus,
        usuarioId,
        reason,
      ),
    );
    if (
      nextStatus === StatusPedido.ACEITO &&
      order.formaPagamento === FormaPagamento.PIX_ASAAS
    ) {
      const payment = await this.payments.createAsaasCharge(
        restauranteId,
        orderId,
      );
      return { ...order, paymentInstructions: payment };
    }
    if (
      nextStatus === StatusPedido.CANCELADO &&
      order.formaPagamento === FormaPagamento.PIX_ASAAS
    ) {
      const paymentAction = await this.payments.cancelAsaasCharge(
        restauranteId,
        orderId,
      );
      if (paymentAction?.refundRequired) {
        return {
          ...order,
          avisoPagamento:
            "O pagamento já foi confirmado; o restaurante precisa providenciar o estorno manualmente.",
        };
      }
    }
    return order;
  }

  private async createOrder(
    restauranteId: string,
    input: CreateOrderDto,
    options: CreateOrderOptions,
  ) {
    const idempotencyKey = options.idempotencyKey?.trim();
    if (options.origem === OrigemPedido.WEB && !idempotencyKey) {
      throw new BadRequestException("Header Idempotency-Key é obrigatório");
    }
    if (idempotencyKey && !/^[A-Za-z0-9._~-]{8,128}$/.test(idempotencyKey)) {
      throw new BadRequestException(
        "Idempotency-Key deve conter de 8 a 128 caracteres válidos",
      );
    }
    const payloadHash = this.hash(this.stableStringify(input));
    const phone = this.normalizeBrazilianPhone(input.telefoneCliente);
    const trackingToken =
      options.origem === OrigemPedido.WEB
        ? randomBytes(32).toString("base64url")
        : undefined;
    const now = new Date();

    try {
      const created = await this.prisma.withTenant(
        restauranteId,
        async (tx) => {
          if (idempotencyKey) {
            const existing = await tx.pedido.findFirst({
              where: { restauranteId, idempotencyKey },
              include: orderDetailsInclude,
            });
            if (existing) {
              if (existing.payloadHash !== payloadHash) {
                throw new ConflictException(
                  "Idempotency-Key já utilizado com conteúdo diferente",
                );
              }
              return {
                order: existing,
                trackingToken: null,
                replayed: true,
              };
            }
          }

          const settings = await tx.configuracaoRestaurante.findUnique({
            where: { restauranteId },
          });
          if (!settings) {
            throw new BadRequestException(
              "Configurações operacionais do restaurante não foram concluídas",
            );
          }
          this.assertDeliveryAndPaymentSettings(settings, input);
          if (input.formaPagamento === FormaPagamento.PIX_MANUAL) {
            const pixConfiguration = await tx.configuracaoPixManual.findUnique({
              where: { restauranteId },
              select: { ativa: true },
            });
            if (!pixConfiguration?.ativa) {
              throw new BadRequestException(
                "A chave Pix manual do restaurante não está configurada",
              );
            }
          }
          if (input.formaPagamento === FormaPagamento.PIX_ASAAS) {
            const gateway = await tx.credencialGateway.findFirst({
              where: {
                restauranteId,
                provedor: ProvedorPagamento.ASAAS,
                ativa: true,
              },
              select: { id: true },
            });
            if (!gateway) {
              throw new BadRequestException(
                "A conta Asaas do restaurante não está conectada",
              );
            }
          }
          if (options.origem === OrigemPedido.WEB) {
            await this.assertRestaurantIsOpen(tx, restauranteId, now);
          }

          const delivery = await this.resolveDelivery(tx, restauranteId, input);
          const prepared = await this.prepareItems(
            tx,
            restauranteId,
            input.itens,
          );
          const totals = calculateOrderTotals(
            prepared.map((item) => ({
              quantity: item.input.quantidade,
              unitPrice: item.unitPrice,
              additionalTotal: item.extraUnitTotal,
            })),
            delivery.fee,
          );
          const changeFor = input.trocoPara
            ? this.money(input.trocoPara, "trocoPara")
            : undefined;
          validateChangeDue(input.formaPagamento, changeFor, totals.total);

          const customer = await tx.cliente.upsert({
            where: {
              restauranteId_telefone: {
                restauranteId,
                telefone: phone,
              },
            },
            create: {
              restauranteId,
              nome: input.nomeCliente.trim(),
              telefone: phone,
            },
            update: {},
            select: { id: true },
          });

          const counter = await tx.contadorPedido.upsert({
            where: { restauranteId },
            create: { restauranteId, proximoNumero: 2n },
            update: { proximoNumero: { increment: 1n } },
            select: { proximoNumero: true },
          });
          const numeroPedido = counter.proximoNumero - 1n;
          const status =
            options.origem === OrigemPedido.WEB
              ? StatusPedido.AGUARDANDO_ACEITE
              : StatusPedido.ACEITO;
          const paymentStatus = this.initialPaymentStatus(input.formaPagamento);
          const paymentExpiry =
            input.formaPagamento === FormaPagamento.PIX_MANUAL ||
            input.formaPagamento === FormaPagamento.PIX_ASAAS
              ? new Date(
                  now.getTime() + settings.prazoPagamentoMinutos * 60_000,
                )
              : null;
          const acceptanceExpiry =
            options.origem === OrigemPedido.WEB
              ? new Date(now.getTime() + settings.prazoAceiteMinutos * 60_000)
              : null;

          const order = await tx.pedido.create({
            data: {
              restauranteId,
              numeroPedido,
              origem: options.origem,
              criadoPorUsuarioId: options.criadoPorUsuarioId,
              clienteId: customer.id,
              nomeContatoSnapshot: input.nomeCliente.trim(),
              telefoneSnapshot: phone,
              tipoEntrega: input.tipoEntrega,
              bairroId: delivery.neighborhoodId,
              bairroSnapshot: delivery.neighborhoodName,
              taxaEntrega: delivery.fee,
              enderecoRuaSnapshot: delivery.address?.rua ?? null,
              enderecoNumeroSnapshot: delivery.address?.numero ?? null,
              enderecoComplementoSnapshot:
                delivery.address?.complemento ?? null,
              enderecoReferenciaSnapshot: delivery.address?.referencia ?? null,
              enderecoCepSnapshot: delivery.address?.cep ?? null,
              enderecoCidadeSnapshot: delivery.address?.cidade ?? null,
              enderecoEstadoSnapshot:
                delivery.address?.estado?.toUpperCase() ?? null,
              formaPagamento: input.formaPagamento,
              trocoPara: changeFor,
              subtotal: totals.subtotal,
              valorTotal: totals.total,
              status,
              observacao: input.observacao?.trim(),
              idempotencyKey,
              payloadHash: idempotencyKey ? payloadHash : null,
              trackingTokenHash: trackingToken
                ? this.hash(trackingToken)
                : null,
              expiraAceiteEm: acceptanceExpiry,
              expiraPagamentoEm: paymentExpiry,
              itens: {
                create: prepared.map((item) => ({
                  restauranteId,
                  produtoId: item.productId,
                  tamanhoId: item.sizeId,
                  sabor1Id: item.flavor1Id,
                  sabor2Id: item.flavor2Id,
                  quantidade: item.input.quantidade,
                  nomeProdutoSnapshot: item.name,
                  descricaoSnapshot: item.description,
                  tamanhoSnapshot: item.sizeName,
                  sabor1Snapshot: item.flavor1Name,
                  sabor2Snapshot: item.flavor2Name,
                  precoSabor1Snapshot: item.flavor1Price,
                  precoSabor2Snapshot: item.flavor2Price,
                  precoUnitario: item.unitPrice,
                  totalLinha: item.unitPrice
                    .plus(item.extraUnitTotal)
                    .times(item.input.quantidade),
                  observacao: item.input.observacao?.trim(),
                  adicionais: {
                    create: item.extras.map((extra) => ({
                      restauranteId,
                      itemAdicionalId: extra.itemAdicionalId,
                      nomeSnapshot: extra.nome,
                      quantidade: extra.quantidade,
                      precoUnitario: extra.preco,
                      totalLinha: extra.preco.times(extra.quantidade),
                    })),
                  },
                })),
              },
              pagamentos: {
                create: {
                  forma: input.formaPagamento,
                  provedor:
                    input.formaPagamento === FormaPagamento.PIX_ASAAS
                      ? ProvedorPagamento.ASAAS
                      : null,
                  status: paymentStatus,
                  valor: totals.total,
                  moeda: "BRL",
                  expiraEm: paymentExpiry,
                },
              },
              eventosStatus: {
                create: {
                  atorTipo:
                    options.origem === OrigemPedido.PDV
                      ? TipoAtorEvento.USUARIO
                      : TipoAtorEvento.SISTEMA,
                  atorUsuarioId: options.criadoPorUsuarioId,
                  statusAnterior: null,
                  statusNovo: status,
                  motivo:
                    options.origem === OrigemPedido.PDV
                      ? "Pedido criado no PDV"
                      : "Pedido recebido pelo cardápio",
                },
              },
            },
            include: orderDetailsInclude,
          });

          await tx.outboxEvento.create({
            data: {
              restauranteId,
              tipo: "PEDIDO_CRIADO",
              agregadoTipo: "PEDIDO",
              agregadoId: order.id,
              payload: {
                pedidoId: order.id,
                numeroPedido: order.numeroPedido.toString(),
                origem: order.origem,
                status: order.status,
              },
            },
          });

          return {
            order,
            trackingToken: trackingToken ?? null,
            replayed: false,
          };
        },
      );
      if (
        created.order.status === StatusPedido.ACEITO &&
        created.order.formaPagamento === FormaPagamento.PIX_ASAAS
      ) {
        const payment = await this.payments.createAsaasCharge(
          restauranteId,
          created.order.id,
        );
        return { ...created, paymentInstructions: payment };
      }
      return created;
    } catch (error) {
      if (
        idempotencyKey &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        const existing = await this.prisma.withTenant(restauranteId, (tx) =>
          tx.pedido.findFirst({
            where: { restauranteId, idempotencyKey },
            include: orderDetailsInclude,
          }),
        );
        if (existing?.payloadHash === payloadHash) {
          const replayed = {
            order: existing,
            trackingToken: null,
            replayed: true,
          };
          if (
            existing.status === StatusPedido.ACEITO &&
            existing.formaPagamento === FormaPagamento.PIX_ASAAS
          ) {
            const payment = await this.payments.createAsaasCharge(
              restauranteId,
              existing.id,
            );
            return { ...replayed, paymentInstructions: payment };
          }
          return replayed;
        }
      }
      throw error;
    }
  }

  private async prepareItems(
    tx: Prisma.TransactionClient,
    restauranteId: string,
    items: CreateOrderDto["itens"],
  ): Promise<PreparedOrderItem[]> {
    const prepared: PreparedOrderItem[] = [];
    for (const item of items) {
      const product = await tx.produto.findFirst({
        where: {
          restauranteId,
          id: item.produtoId,
          ativo: true,
          disponivel: true,
        },
        include: {
          precos: {
            where: item.tamanhoId ? { tamanhoId: item.tamanhoId } : undefined,
            include: { tamanho: true },
          },
          gruposAdicionais: {
            include: {
              grupo: {
                include: {
                  itens: {
                    where: { disponivel: true },
                    orderBy: { ordem: "asc" },
                  },
                },
              },
            },
          },
        },
      });
      if (!product) {
        throw new BadRequestException(
          "Um ou mais produtos não existem ou estão indisponíveis",
        );
      }

      let unitPrice: Prisma.Decimal;
      let flavor1Id: string | null = null;
      let flavor1Name: string | null = null;
      let flavor1Price: Prisma.Decimal | null = null;
      let flavor2Id: string | null = null;
      let flavor2Name: string | null = null;
      let flavor2Price: Prisma.Decimal | null = null;
      let sizeName: string | null = null;

      if (product.tipo === TipoProduto.NORMAL) {
        if (item.tamanhoId || item.sabor2Id || product.preco === null) {
          throw new BadRequestException(
            `Produto "${product.nome}" não aceita tamanho nem meio a meio`,
          );
        }
        unitPrice = product.preco;
      } else {
        if (!item.tamanhoId) {
          throw new BadRequestException(
            `Selecione o tamanho para a pizza "${product.nome}"`,
          );
        }
        const firstSizePrice = product.precos.find(
          (price) => price.tamanhoId === item.tamanhoId,
        );
        if (!firstSizePrice || !firstSizePrice.tamanho.ativo) {
          throw new BadRequestException(
            `A pizza "${product.nome}" não tem preço para o tamanho selecionado`,
          );
        }
        flavor1Id = product.id;
        flavor1Name = product.nome;
        flavor1Price = firstSizePrice.preco;
        sizeName = firstSizePrice.tamanho.nome;
        unitPrice = firstSizePrice.preco;

        if (item.sabor2Id) {
          if (item.sabor2Id === product.id) {
            throw new BadRequestException(
              "Os sabores da pizza meio a meio devem ser diferentes",
            );
          }
          if (firstSizePrice.tamanho.quantidadeMaxSabores < 2) {
            throw new BadRequestException(
              "O tamanho selecionado não permite pizza meio a meio",
            );
          }
          const secondFlavor = await tx.produto.findFirst({
            where: {
              restauranteId,
              id: item.sabor2Id,
              tipo: TipoProduto.SABOR_PIZZA,
              ativo: true,
              disponivel: true,
            },
            include: {
              precos: {
                where: { tamanhoId: item.tamanhoId },
              },
            },
          });
          const secondSizePrice = secondFlavor?.precos[0];
          if (!secondFlavor || !secondSizePrice) {
            throw new BadRequestException(
              "O segundo sabor não está disponível para o tamanho selecionado",
            );
          }
          flavor2Id = secondFlavor.id;
          flavor2Name = secondFlavor.nome;
          flavor2Price = secondSizePrice.preco;
          unitPrice = Prisma.Decimal.max(flavor1Price, flavor2Price);
        }
      }

      const extras = this.validateSelectedAdditionGroups(
        product.gruposAdicionais,
        item.gruposAdicionais ?? [],
      );
      const extraUnitTotal = extras.reduce(
        (sum, extra) => sum.plus(extra.preco.times(extra.quantidade)),
        new Prisma.Decimal(0),
      );

      prepared.push({
        input: item,
        productId: product.id,
        name:
          flavor2Name !== null
            ? `Pizza meio a meio: ${flavor1Name} / ${flavor2Name}`
            : product.nome,
        description: product.descricao,
        sizeId: item.tamanhoId ?? null,
        sizeName,
        flavor1Id,
        flavor1Name,
        flavor1Price,
        flavor2Id,
        flavor2Name,
        flavor2Price,
        unitPrice,
        extras,
        extraUnitTotal,
      });
    }
    return prepared;
  }

  private validateSelectedAdditionGroups(
    configuredGroups: Array<{
      grupoId: string;
      obrigatorio: boolean;
      minimo: number;
      maximo: number;
      grupo: {
        ativo: boolean;
        itens: Array<{
          id: string;
          nome: string;
          preco: Prisma.Decimal;
          disponivel: boolean;
        }>;
      };
    }>,
    selections: NonNullable<
      CreateOrderDto["itens"][number]["gruposAdicionais"]
    >,
  ): PreparedAdditional[] {
    const selectionByGroup = new Map(
      selections.map((selection) => [selection.grupoId, selection]),
    );
    if (selectionByGroup.size !== selections.length) {
      throw new BadRequestException(
        "Um grupo de adicionais não pode ser enviado mais de uma vez",
      );
    }
    for (const groupId of selectionByGroup.keys()) {
      if (!configuredGroups.some((group) => group.grupoId === groupId)) {
        throw new BadRequestException(
          "Grupo de adicionais não pertence ao produto selecionado",
        );
      }
    }

    const extras: PreparedAdditional[] = [];
    for (const configured of configuredGroups) {
      if (!configured.grupo.ativo) {
        throw new BadRequestException(
          "O produto possui um grupo de adicionais inativo",
        );
      }
      const selected = selectionByGroup.get(configured.grupoId);
      const selectedItems = selected?.itens ?? [];
      const distinctIds = new Set(
        selectedItems.map((item) => item.itemAdicionalId),
      );
      if (distinctIds.size !== selectedItems.length) {
        throw new BadRequestException(
          "O mesmo adicional não pode ser repetido; informe a quantidade",
        );
      }
      const selectionCount = selectedItems.reduce(
        (sum, item) => sum + (item.quantidade ?? 1),
        0,
      );
      if (
        selectionCount < configured.minimo ||
        selectionCount > configured.maximo
      ) {
        throw new BadRequestException(
          `Selecione entre ${configured.minimo} e ${configured.maximo} itens no grupo de adicionais`,
        );
      }

      for (const selection of selectedItems) {
        const additional = configured.grupo.itens.find(
          (item) => item.id === selection.itemAdicionalId,
        );
        if (!additional || !additional.disponivel) {
          throw new BadRequestException(
            "Um ou mais adicionais não existem ou estão indisponíveis",
          );
        }
        extras.push({
          itemAdicionalId: additional.id,
          nome: additional.nome,
          quantidade: selection.quantidade ?? 1,
          preco: additional.preco,
        });
      }
    }
    return extras;
  }

  private async resolveDelivery(
    tx: Prisma.TransactionClient,
    restauranteId: string,
    input: CreateOrderDto,
  ) {
    if (input.tipoEntrega === TipoEntrega.RETIRADA) {
      if (input.endereco) {
        throw new BadRequestException(
          "Retirada não deve incluir endereço de entrega",
        );
      }
      return {
        fee: new Prisma.Decimal(0),
        neighborhoodId: null,
        neighborhoodName: null,
        address: null,
      };
    }
    if (!input.endereco) {
      throw new BadRequestException(
        "Endereço é obrigatório para pedidos delivery",
      );
    }
    const neighborhood = await tx.bairroEntrega.findFirst({
      where: {
        restauranteId,
        id: input.endereco.bairroId,
        ativo: true,
      },
      select: { id: true, nome: true, taxaEntrega: true },
    });
    if (!neighborhood) {
      throw new BadRequestException(
        "Bairro de entrega não existe neste restaurante ou está indisponível",
      );
    }
    return {
      fee: neighborhood.taxaEntrega,
      neighborhoodId: neighborhood.id,
      neighborhoodName: neighborhood.nome,
      address: input.endereco,
    };
  }

  private assertDeliveryAndPaymentSettings(
    settings: {
      deliveryHabilitado: boolean;
      retiradaHabilitada: boolean;
      aceitarPixManual: boolean;
      aceitarPixAsaas: boolean;
      aceitarDinheiro: boolean;
      aceitarCartaoCredito: boolean;
      aceitarCartaoDebito: boolean;
    },
    input: CreateOrderDto,
  ): void {
    if (
      input.tipoEntrega === TipoEntrega.DELIVERY &&
      !settings.deliveryHabilitado
    ) {
      throw new BadRequestException("Delivery não está habilitado");
    }
    if (
      input.tipoEntrega === TipoEntrega.RETIRADA &&
      !settings.retiradaHabilitada
    ) {
      throw new BadRequestException("Retirada não está habilitada");
    }
    const enabled: Record<FormaPagamento, boolean> = {
      PIX_MANUAL: settings.aceitarPixManual,
      PIX_ASAAS: settings.aceitarPixAsaas,
      DINHEIRO: settings.aceitarDinheiro,
      CARTAO_CREDITO: settings.aceitarCartaoCredito,
      CARTAO_DEBITO: settings.aceitarCartaoDebito,
    };
    if (!enabled[input.formaPagamento]) {
      throw new BadRequestException(
        "A forma de pagamento selecionada não está habilitada",
      );
    }
  }

  private async assertRestaurantIsOpen(
    tx: Prisma.TransactionClient,
    restauranteId: string,
    now: Date,
  ) {
    const intervals = await tx.horarioFuncionamento.findMany({
      where: { restauranteId, ativo: true },
      select: { diaSemana: true, abreAs: true, fechaAs: true },
    });
    if (!isOpenAt(intervals, now)) {
      throw new ConflictException(
        "O restaurante não está aceitando pedidos neste horário",
      );
    }
  }

  private async transitionInTransaction(
    tx: Prisma.TransactionClient,
    restauranteId: string,
    orderId: string,
    next: StatusPedido,
    usuarioId?: string,
    reason?: string,
  ) {
    const order = await tx.pedido.findFirst({
      where: { restauranteId, id: orderId },
      select: { id: true, status: true, tipoEntrega: true },
    });
    if (!order) {
      throw new NotFoundException("Pedido não encontrado");
    }
    validateOrderTransition(order.status, next, order.tipoEntrega, reason);
    const update = await tx.pedido.updateMany({
      where: { restauranteId, id: orderId, status: order.status },
      data: { status: next },
    });
    if (update.count !== 1) {
      throw new ConflictException(
        "O pedido foi atualizado por outra operação; recarregue e tente novamente",
      );
    }
    await tx.eventoStatusPedido.create({
      data: {
        restauranteId,
        pedidoId: orderId,
        atorTipo: usuarioId ? TipoAtorEvento.USUARIO : TipoAtorEvento.SISTEMA,
        atorUsuarioId: usuarioId,
        statusAnterior: order.status,
        statusNovo: next,
        motivo: reason?.trim(),
      },
    });
    await tx.outboxEvento.create({
      data: {
        restauranteId,
        tipo: "STATUS_PEDIDO_ATUALIZADO",
        agregadoTipo: "PEDIDO",
        agregadoId: orderId,
        payload: { pedidoId: orderId, status: next },
      },
    });
    return tx.pedido.findUniqueOrThrow({
      where: { restauranteId_id: { restauranteId, id: orderId } },
      include: orderDetailsInclude,
    });
  }

  private initialPaymentStatus(forma: FormaPagamento): StatusPagamento {
    switch (forma) {
      case FormaPagamento.PIX_MANUAL:
        return StatusPagamento.AGUARDANDO_CONFIRMACAO_MANUAL;
      case FormaPagamento.PIX_ASAAS:
        return StatusPagamento.AGUARDANDO_CRIACAO_GATEWAY;
      default:
        return StatusPagamento.A_PAGAR;
    }
  }

  private money(value: string, field: string): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException(`${field} inválido`);
    }
    if (
      !amount.isFinite() ||
      amount.isNegative() ||
      amount.decimalPlaces() > 2
    ) {
      throw new BadRequestException(`${field} inválido`);
    }
    return amount;
  }

  private normalizeBrazilianPhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    const validLocal = digits.length === 10 || digits.length === 11;
    const validWithCountryCode =
      (digits.length === 12 || digits.length === 13) && digits.startsWith("55");
    if (!validLocal && !validWithCountryCode) {
      throw new BadRequestException("Telefone brasileiro inválido");
    }
    return digits;
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.stableStringify(record[key])}`,
        )
        .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
  }
}
