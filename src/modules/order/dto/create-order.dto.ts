import { Transform, Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import { FormaPagamento, StatusPedido, TipoEntrega } from "@prisma/client";

export class OrderItemAdditionalDto {
  @IsUUID()
  itemAdicionalId!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  quantidade?: number;
}

export class OrderItemGroupSelectionDto {
  @IsUUID()
  grupoId!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemAdditionalDto)
  itens!: OrderItemAdditionalDto[];
}

export class CreateOrderItemDto {
  @IsUUID()
  produtoId!: string;

  @IsOptional()
  @IsUUID()
  tamanhoId?: string;

  @IsOptional()
  @IsUUID()
  sabor2Id?: string;

  @IsInt()
  @Min(1)
  @Max(99)
  quantidade!: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  observacao?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemGroupSelectionDto)
  gruposAdicionais?: OrderItemGroupSelectionDto[];
}

export class DeliveryAddressDto {
  @IsUUID()
  bairroId!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  rua!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  numero!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  complemento?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  referencia?: string;

  @IsOptional()
  @Matches(/^\d{5}-?\d{3}$/)
  cep?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  cidade?: string;

  @IsOptional()
  @Matches(/^[A-Za-z]{2}$/)
  estado?: string;
}

export class CreateOrderDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nomeCliente!: string;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @Matches(/^\+?[\d\s().-]{10,20}$/)
  telefoneCliente!: string;

  @IsEnum(TipoEntrega)
  tipoEntrega!: TipoEntrega;

  @IsOptional()
  @ValidateNested()
  @Type(() => DeliveryAddressDto)
  endereco?: DeliveryAddressDto;

  @IsEnum(FormaPagamento)
  formaPagamento!: FormaPagamento;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  trocoPara?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observacao?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  itens!: CreateOrderItemDto[];
}

export class UpdateOrderStatusDto {
  @IsEnum(StatusPedido)
  status!: StatusPedido;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  motivo?: string;
}

export class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(StatusPedido)
  status?: StatusPedido;

  @IsOptional()
  @IsInt()
  @Type(() => Number)
  @Min(1)
  @Max(100)
  limite?: number;

  @IsOptional()
  @IsUUID()
  cursor?: string;
}
