import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PaymentModule } from "../payment/payment.module";
import { OrderService } from "./order.service";
import { PublicOrdersController } from "./public-orders.controller";
import { RestaurantOrdersController } from "./restaurant-orders.controller";

@Module({
  imports: [AuthModule, PaymentModule],
  controllers: [PublicOrdersController, RestaurantOrdersController],
  providers: [OrderService],
  exports: [OrderService],
})
export class OrderModule {}
