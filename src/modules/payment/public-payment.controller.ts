import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { TenantRequest } from "../tenancy/tenant-request";
import { PaymentService } from "./payment.service";

@ApiTags("Pagamentos públicos")
@Controller("public/orders")
export class PublicPaymentController {
  constructor(private readonly payments: PaymentService) {}

  @Get(":trackingToken/payment")
  @ApiOperation({ summary: "Retorna as instruções de pagamento do pedido" })
  getInstructions(
    @Req() request: TenantRequest,
    @Param("trackingToken") trackingToken: string,
  ) {
    if (!request.tenant) {
      throw new BadRequestException(
        "Restaurante não resolvido para esta requisição",
      );
    }
    return this.payments.publicInstructions(request.tenant.id, trackingToken);
  }
}
