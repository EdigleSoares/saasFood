import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { TenantRequest } from "../tenancy/tenant-request";
import { CreateOrderDto } from "./dto/create-order.dto";
import { OrderService } from "./order.service";

@ApiTags("Pedidos públicos")
@Controller("public")
export class PublicOrdersController {
  constructor(private readonly orders: OrderService) {}

  @Post("orders")
  @ApiOperation({
    summary: "Cria um pedido web e retorna um token privado de acompanhamento",
  })
  createOrder(
    @Req() request: TenantRequest,
    @Body() input: CreateOrderDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.orders.createPublicOrder(
      this.tenantId(request),
      input,
      idempotencyKey ?? "",
    );
  }

  @Get("orders/:trackingToken")
  @ApiOperation({
    summary: "Consulta os dados mínimos do pedido por token bearer privado",
  })
  getTracking(
    @Req() request: TenantRequest,
    @Param("trackingToken") trackingToken: string,
  ) {
    return this.orders.getPublicTracking(this.tenantId(request), trackingToken);
  }

  @Post("orders/:trackingToken/cancel")
  @ApiOperation({
    summary: "Cancela pedido somente enquanto aguarda aceite do restaurante",
  })
  cancelOrder(
    @Req() request: TenantRequest,
    @Param("trackingToken") trackingToken: string,
  ) {
    return this.orders.cancelPublicOrder(this.tenantId(request), trackingToken);
  }

  private tenantId(request: TenantRequest): string {
    if (!request.tenant) {
      throw new BadRequestException(
        "Restaurante não resolvido para esta requisição",
      );
    }
    return request.tenant.id;
  }
}
