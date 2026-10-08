import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreatePizzaSizeDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  quantidadeMaxSabores?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ordem?: number;
}

export class UpdatePizzaSizeDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  quantidadeMaxSabores?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ordem?: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
