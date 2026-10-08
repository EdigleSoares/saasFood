import { Injectable } from "@nestjs/common";
import { PaymentProvider } from "./payment-provider";

export interface ManualPixInstructions {
  tipoChave: string;
  chavePix: string;
  nomeRecebedor: string | null;
  instrucoes: string;
  confirmacaoManual: true;
}

@Injectable()
export class ManualPixProvider implements PaymentProvider {
  readonly kind = "MANUAL" as const;

  createInstructions(
    type: string,
    key: string,
    receiverName: string | null,
  ): ManualPixInstructions {
    return {
      tipoChave: type,
      chavePix: key,
      nomeRecebedor: receiverName,
      instrucoes:
        "Faça o Pix usando a chave informada e aguarde a confirmação manual do restaurante.",
      confirmacaoManual: true,
    };
  }
}
