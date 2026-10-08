import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PapelUsuario } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth.types";
import { JwtAccessGuard } from "../auth/jwt-access.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { CustomerService } from "./customer.service";
import { ListCustomersDto } from "./dto/list-customers.dto";

@ApiTags("Clientes")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER)
@Controller("restaurant/customers")
export class CustomerController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  listCustomers(
    @Req() request: AuthenticatedRequest,
    @Query() query: ListCustomersDto,
  ) {
    return this.customers.listCustomers(this.tenantId(request), query);
  }

  @Get(":customerId")
  getCustomer(
    @Req() request: AuthenticatedRequest,
    @Param("customerId", ParseUUIDPipe) customerId: string,
  ) {
    return this.customers.getCustomer(this.tenantId(request), customerId);
  }

  private tenantId(request: AuthenticatedRequest): string {
    if (!request.tenant || request.user?.restauranteId !== request.tenant.id) {
      throw new ForbiddenException("Sessão sem tenant válido");
    }
    return request.tenant.id;
  }
}
