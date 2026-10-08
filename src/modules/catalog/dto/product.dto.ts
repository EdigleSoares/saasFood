import { Transform, Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
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
import { TipoProduto } from "@prisma/client";
import { IsEnum } from "class-validator";

export class ProductSizePriceDto {
  @IsUUID()
  tamanhoId!: string;

  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  preco!: string;
}

export class ProductAdditionalRuleDto {
  @IsUUID()
  grupoId!: string;

  @IsOptional()
  @IsBoolean()
  obrigatorio?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minimo?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  maximo?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ordem?: number;
}

export class CreateProductDto {
  @IsOptional()
  @IsUUID()
  categoriaId?: string;

  @IsEnum(TipoProduto)
  tipo!: TipoProduto;

  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nome!: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  descricao?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imagemKey?: string;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  preco?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSizePriceDto)
  precos?: ProductSizePriceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAdditionalRuleDto)
  gruposAdicionais?: ProductAdditionalRuleDto[];
}

export class UpdateProductDto {
  @IsOptional()
  @IsUUID()
  categoriaId?: string | null;

  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  descricao?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  imagemKey?: string | null;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  preco?: string;

  @IsOptional()
  @IsBoolean()
  disponivel?: boolean;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSizePriceDto)
  precos?: ProductSizePriceDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductAdditionalRuleDto)
  gruposAdicionais?: ProductAdditionalRuleDto[];
}

export class UpdateProductAvailabilityDto {
  @IsBoolean()
  disponivel!: boolean;
}
