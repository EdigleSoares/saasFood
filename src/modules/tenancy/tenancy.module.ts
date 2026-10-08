import { Module } from "@nestjs/common";
import { TenantResolutionMiddleware } from "./tenant-resolution.middleware";

@Module({
  providers: [TenantResolutionMiddleware],
  exports: [TenantResolutionMiddleware],
})
export class TenancyModule {}
