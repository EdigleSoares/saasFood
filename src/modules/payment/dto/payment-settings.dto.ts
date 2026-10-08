import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from "class-validator";

export class SetManualPixDto {
  @IsIn(["CPF", "CNPJ", "EMAIL", "CELULAR", "ALEATORIA"])
  tipoChave!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(255)
  chavePix!: string;

  @IsString()
  @MaxLength(120)
  nomeRecebedor!: string;
}

export class SetAsaasCredentialDto {
  @IsString()
  @MinLength(20)
  @MaxLength(500)
  apiKey!: string;
}

export class ManualPaymentDecisionDto {
  @IsString()
  @MaxLength(255)
  motivo!: string;
}

export class RefundPaymentDto {
  @IsOptional()
  @IsString()
  @Matches(/^\d{1,10}(?:\.\d{1,2})?$/)
  valor?: string;
}
