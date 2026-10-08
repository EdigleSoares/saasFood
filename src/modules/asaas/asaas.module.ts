import { Module } from "@nestjs/common";
import { AsaasAdapter } from "./asaas.adapter";

@Module({
  providers: [AsaasAdapter],
  exports: [AsaasAdapter],
})
export class AsaasModule {}
