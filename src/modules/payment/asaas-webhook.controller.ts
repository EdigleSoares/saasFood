import { Controller, Headers, Post, RawBodyRequest, Req } from "@nestjs/common";
import { ApiExcludeEndpoint } from "@nestjs/swagger";
import { Request } from "express";
import { PaymentService } from "./payment.service";

@Controller("webhooks")
export class AsaasWebhookController {
  constructor(private readonly payments: PaymentService) {}

  @Post("asaas")
  @ApiExcludeEndpoint()
  receive(
    @Headers("asaas-access-token") accessToken: string | undefined,
    @Req() request: RawBodyRequest<Request>,
  ) {
    return this.payments.receiveAsaasWebhook(accessToken, request.rawBody);
  }
}
