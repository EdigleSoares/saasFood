import { Transform } from "class-transformer";
import {
  IsInt,
  IsBoolean,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class CreateCategoryDto {
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome!: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ordem?: number;
}

export class UpdateCategoryDto {
  @IsOptional()
  @Transform(({ value }) => (typeof value === "string" ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  nome?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  ordem?: number;

  @IsOptional()
  @IsBoolean()
  ativo?: boolean;
}
