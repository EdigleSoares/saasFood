import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AsaasModule } from "./modules/asaas/asaas.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CatalogModule } from "./modules/catalog/catalog.module";
import { CustomerModule } from "./modules/customer/customer.module";
import { HealthModule } from "./modules/health/health.module";
import { MediaModule } from "./modules/media/media.module";
import { NotificationModule } from "./modules/notification/notification.module";
import { OrderModule } from "./modules/order/order.module";
import { PaymentModule } from "./modules/payment/payment.module";
import { RestaurantModule } from "./modules/restaurant/restaurant.module";
import { TenancyModule } from "./modules/tenancy/tenancy.module";
import { UsersModule } from "./modules/users/users.module";
import { PrismaModule } from "./database/prisma.module";
import { ScheduleModule } from "@nestjs/schedule";

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    TenancyModule,
    AuthModule,
    UsersModule,
    RestaurantModule,
    CatalogModule,
    CustomerModule,
    OrderModule,
    PaymentModule,
    AsaasModule,
    NotificationModule,
    MediaModule,
    HealthModule,
  ],
})
export class AppModule {}
