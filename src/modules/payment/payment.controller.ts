import {
  Body,
  Controller,
  ForbiddenException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PapelUsuario } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth.types";
import { JwtAccessGuard } from "../auth/jwt-access.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import {
  ManualPaymentDecisionDto,
  RefundPaymentDto,
  SetAsaasCredentialDto,
  SetManualPixDto,
} from "./dto/payment-settings.dto";
import { PaymentService } from "./payment.service";

@ApiTags("Pagamentos do restaurante")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Controller("restaurant")
export class PaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Put("payment-settings/manual-pix")
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER)
  configureManualPix(
    @Req() request: AuthenticatedRequest,
    @Body() input: SetManualPixDto,
  ) {
    return this.payments.configureManualPix(
      this.tenantId(request),
      input.tipoChave,
      input.chavePix,
      input.nomeRecebedor,
    );
  }

  @Put("payment-settings/asaas")
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER)
  configureAsaas(
    @Req() request: AuthenticatedRequest,
    @Body() input: SetAsaasCredentialDto,
  ) {
    return this.payments.configureAsaas(this.tenantId(request), input.apiKey);
  }

  @Post("orders/:orderId/payments/manual/confirm")
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER, PapelUsuario.ATTENDANT)
  confirmManual(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    const user = this.user(request);
    return this.payments.confirmManualPayment(
      this.tenantId(request),
      orderId,
      user.id,
      true,
    );
  }

  @Post("orders/:orderId/payments/manual/reject")
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER, PapelUsuario.ATTENDANT)
  rejectManual(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
    @Body() input: ManualPaymentDecisionDto,
  ) {
    const user = this.user(request);
    return this.payments.confirmManualPayment(
      this.tenantId(request),
      orderId,
      user.id,
      false,
      input.motivo,
    );
  }

  @Post("orders/:orderId/payments/asaas")
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER, PapelUsuario.ATTENDANT)
  createAsaasCharge(
    @Req() request: AuthenticatedRequest,
    @Param("orderId", ParseUUIDPipe) orderId: string,
  ) {
    return this.payments.createAsaasCharge(this.tenantId(request), orderId);
  }

  @Post("payments/:paymentId/refund")
  @Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER)
  refund(
    @Req() request: AuthenticatedRequest,
    @Param("paymentId", ParseUUIDPipe) paymentId: string,
    @Body() input: RefundPaymentDto,
  ) {
    return this.payments.refundAsaas(
      this.tenantId(request),
      paymentId,
      input.valor,
    );
  }

  private tenantId(request: AuthenticatedRequest): string {
    if (!request.tenant || request.user?.restauranteId !== request.tenant.id) {
      throw new ForbiddenException("Sessão sem tenant válido");
    }
    return request.tenant.id;
  }

  private user(request: AuthenticatedRequest) {
    const user = request.user;
    if (!user) throw new ForbiddenException("Usuário autenticado ausente");
    return user;
  }
}
