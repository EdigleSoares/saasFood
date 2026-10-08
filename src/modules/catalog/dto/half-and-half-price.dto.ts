import { IsUUID } from "class-validator";

export class HalfAndHalfPriceDto {
  @IsUUID()
  tamanhoId!: string;

  @IsUUID()
  sabor1Id!: string;

  @IsUUID()
  sabor2Id!: string;
}
