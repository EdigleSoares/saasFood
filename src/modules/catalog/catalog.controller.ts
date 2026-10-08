import {
  Body,
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { PapelUsuario } from "@prisma/client";
import { AuthenticatedRequest } from "../auth/auth.types";
import { JwtAccessGuard } from "../auth/jwt-access.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { CreateCategoryDto, UpdateCategoryDto } from "./dto/category.dto";
import {
  CreateProductDto,
  UpdateProductAvailabilityDto,
  UpdateProductDto,
} from "./dto/product.dto";
import { CreatePizzaSizeDto, UpdatePizzaSizeDto } from "./dto/pizza-size.dto";
import {
  CreateAdditionalGroupDto,
  CreateAdditionalItemDto,
  UpdateAdditionalGroupDto,
  UpdateAdditionalItemDto,
} from "./dto/additional.dto";
import { HalfAndHalfPriceDto } from "./dto/half-and-half-price.dto";
import { CatalogService } from "./catalog.service";

@ApiTags("Catálogo")
@ApiBearerAuth()
@UseGuards(JwtAccessGuard, RolesGuard)
@Roles(PapelUsuario.OWNER, PapelUsuario.MANAGER)
@Controller("restaurant")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get("categories")
  @ApiOperation({ summary: "Lista categorias do restaurante" })
  listCategories(@Req() request: AuthenticatedRequest) {
    return this.catalog.listCategories(this.tenantId(request));
  }

  @Post("categories")
  @ApiOperation({ summary: "Cria uma categoria" })
  createCategory(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateCategoryDto,
  ) {
    return this.catalog.createCategory(this.tenantId(request), input);
  }

  @Patch("categories/:categoryId")
  updateCategory(
    @Req() request: AuthenticatedRequest,
    @Param("categoryId", ParseUUIDPipe) categoryId: string,
    @Body() input: UpdateCategoryDto,
  ) {
    return this.catalog.updateCategory(
      this.tenantId(request),
      categoryId,
      input,
    );
  }

  @Delete("categories/:categoryId")
  @ApiOperation({ summary: "Arquiva uma categoria sem apagar o histórico" })
  archiveCategory(
    @Req() request: AuthenticatedRequest,
    @Param("categoryId", ParseUUIDPipe) categoryId: string,
  ) {
    return this.catalog.archiveCategory(this.tenantId(request), categoryId);
  }

  @Get("products")
  @ApiOperation({ summary: "Lista produtos e suas variações configuradas" })
  listProducts(
    @Req() request: AuthenticatedRequest,
    @Query("incluirInativos") includeInactive?: string,
  ) {
    if (
      includeInactive !== undefined &&
      includeInactive !== "true" &&
      includeInactive !== "false"
    ) {
      throw new BadRequestException("incluirInativos deve ser true ou false");
    }
    return this.catalog.listProducts(
      this.tenantId(request),
      includeInactive === "true",
    );
  }

  @Get("products/:productId")
  getProduct(
    @Req() request: AuthenticatedRequest,
    @Param("productId", ParseUUIDPipe) productId: string,
  ) {
    return this.catalog.getProduct(this.tenantId(request), productId);
  }

  @Post("products")
  @ApiOperation({
    summary:
      "Cria produto ou sabor de pizza com preços por tamanho e adicionais",
  })
  createProduct(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateProductDto,
  ) {
    return this.catalog.createProduct(this.tenantId(request), input);
  }

  @Patch("products/:productId")
  updateProduct(
    @Req() request: AuthenticatedRequest,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() input: UpdateProductDto,
  ) {
    return this.catalog.updateProduct(this.tenantId(request), productId, input);
  }

  @Patch("products/:productId/availability")
  setProductAvailability(
    @Req() request: AuthenticatedRequest,
    @Param("productId", ParseUUIDPipe) productId: string,
    @Body() input: UpdateProductAvailabilityDto,
  ) {
    return this.catalog.setProductAvailability(
      this.tenantId(request),
      productId,
      input.disponivel,
    );
  }

  @Delete("products/:productId")
  @ApiOperation({ summary: "Arquiva produto sem remover pedidos históricos" })
  archiveProduct(
    @Req() request: AuthenticatedRequest,
    @Param("productId", ParseUUIDPipe) productId: string,
  ) {
    return this.catalog.archiveProduct(this.tenantId(request), productId);
  }

  @Get("pizza-sizes")
  listPizzaSizes(@Req() request: AuthenticatedRequest) {
    return this.catalog.listPizzaSizes(this.tenantId(request));
  }

  @Post("pizza-sizes")
  createPizzaSize(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreatePizzaSizeDto,
  ) {
    return this.catalog.createPizzaSize(this.tenantId(request), input);
  }

  @Patch("pizza-sizes/:sizeId")
  updatePizzaSize(
    @Req() request: AuthenticatedRequest,
    @Param("sizeId", ParseUUIDPipe) sizeId: string,
    @Body() input: UpdatePizzaSizeDto,
  ) {
    return this.catalog.updatePizzaSize(this.tenantId(request), sizeId, input);
  }

  @Post("pizza-pricing/half-and-half")
  @ApiOperation({
    summary: "Calcula preço meio a meio pelo maior preço dos dois sabores",
  })
  calculateHalfAndHalfPrice(
    @Req() request: AuthenticatedRequest,
    @Body() input: HalfAndHalfPriceDto,
  ) {
    return this.catalog.calculateHalfAndHalfPrice(
      this.tenantId(request),
      input.tamanhoId,
      input.sabor1Id,
      input.sabor2Id,
    );
  }

  @Get("additional-groups")
  listAdditionalGroups(@Req() request: AuthenticatedRequest) {
    return this.catalog.listAdditionalGroups(this.tenantId(request));
  }

  @Post("additional-groups")
  createAdditionalGroup(
    @Req() request: AuthenticatedRequest,
    @Body() input: CreateAdditionalGroupDto,
  ) {
    return this.catalog.createAdditionalGroup(this.tenantId(request), input);
  }

  @Patch("additional-groups/:groupId")
  updateAdditionalGroup(
    @Req() request: AuthenticatedRequest,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Body() input: UpdateAdditionalGroupDto,
  ) {
    return this.catalog.updateAdditionalGroup(
      this.tenantId(request),
      groupId,
      input,
    );
  }

  @Post("additional-groups/:groupId/items")
  createAdditionalItem(
    @Req() request: AuthenticatedRequest,
    @Param("groupId", ParseUUIDPipe) groupId: string,
    @Body() input: CreateAdditionalItemDto,
  ) {
    return this.catalog.createAdditionalItem(
      this.tenantId(request),
      groupId,
      input,
    );
  }

  @Patch("additional-items/:itemId")
  updateAdditionalItem(
    @Req() request: AuthenticatedRequest,
    @Param("itemId", ParseUUIDPipe) itemId: string,
    @Body() input: UpdateAdditionalItemDto,
  ) {
    return this.catalog.updateAdditionalItem(
      this.tenantId(request),
      itemId,
      input,
    );
  }

  private tenantId(request: AuthenticatedRequest): string {
    if (!request.tenant || request.user?.restauranteId !== request.tenant.id) {
      throw new ForbiddenException(
        "Contexto de restaurante ausente ou inconsistente",
      );
    }
    return request.tenant.id;
  }
}
