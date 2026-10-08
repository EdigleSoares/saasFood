import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateAdditionalGroupDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome!: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descricao?: string;
}

export class UpdateAdditionalGroupDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  descricao?: string | null;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}

export class CreateAdditionalItemDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome!: string;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  preco?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ordem?: number;
}

export class UpdateAdditionalItemDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome?: string;

  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/)
  preco?: string;

  @IsOptional()
  @IsBoolean()
  disponivel?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ordem?: number;
}
