import {
  Body,
  ForbiddenException,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  Headers,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PapelUsuario } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth.types";
import { JwtAccessGuard } from "../auth/jwt-access.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import {
  CreateOrderDto,
  ListOrdersQueryDto,
  UpdateOrderStatusDto,
} from "./dto/create-order.dto";
import { OrderService } from "./order.service";

@ApiTags("Pedidos do restaurante")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("restaurant/orders")
export class RestaurantOrdersController {
  constructor(private readonly orders: OrderService) {}

  @Post()
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER, PapelUsuario.ATTENDANT)
  @ApiOperation({ summary: "Cria pedido de balcão no PDV como aceito" })
  createPosOrder(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateOrderDto,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    const user = request.user;
    if (!request.tenant || !user || request.tenant.id !== user.restauranteId) {
      throw new ForbiddenException("Sessão sem tenant válido");
    }
    return this.orders.createPosOrder(
      request.tenant.id,
      user.id,
      input,
      idempotencyKey,
    );
  }

  @Get()
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER, PapelUsuario.ATTENDANT)
  listOrders(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListOrdersQueryDto,
  ) {
    return this.orders.listOrders(this.tenantId(request), query);
  }

  @Get(":orderId")
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER, PapelUsuario.ATTENDANT)
  getOrder(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    return this.orders.getOrder(this.tenantId(request), orderId);
  }

  @Patch(":orderId/status")
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER, PapelUsuario.ATTENDANT)
  @ApiOperation({ summary: "Avança o estado do pedido respeitando transições" })
  transitionStatus(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: UpdateOrderStatusDto,
  ) {
    const user = request.user;
    if (!user) {
      throw new ForbiddenException("Usuário autenticado ausente");
    }
    return this.orders.transitionStatus(
      this.tenantId(request),
      orderId,
      input.status,
      user.id,
      input.motivo,
    );
  }

  private tenantId(request: AuthenticatedRequest): string {
    if (!request.tenant || request.user?.restauranteId !== request.tenant.id) {
      throw new ForbiddenException("Sessão sem tenant válido");
    }
    return request.tenant.id;
  }
}
