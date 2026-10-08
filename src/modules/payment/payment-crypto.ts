import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const CIPHER_PREFIX = "v1";

export function encryptPaymentSecret(
  secret: string,
  config: ConfigService,
): string {
  const key = encryptionKey(config);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
  ]);
  return [
    CIPHER_PREFIX,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptPaymentSecret(
  encryptedSecret: string,
  config: ConfigService,
): string {
  const [version, ivText, tagText, ciphertextText, ...extra] =
    encryptedSecret.split(".");
  if (
    version !== CIPHER_PREFIX ||
    !ivText ||
    !tagText ||
    !ciphertextText ||
    extra.length
  ) {
    throw new InternalServerErrorException(
      "Credencial de pagamento armazenada em formato inválido",
    );
  }

  try {
    const authTag = Buffer.from(tagText, "base64url");
    if (authTag.length !== 16) {
      throw new Error("Invalid AES-GCM authentication tag length");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      encryptionKey(config),
      Buffer.from(ivText, "base64url"),
      { authTagLength: 16 },
    );
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextText, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new InternalServerErrorException(
      "Não foi possível descriptografar a credencial de pagamento",
    );
  }
}

function encryptionKey(config: ConfigService): Buffer {
  const value = config.get<string>("DATA_ENCRYPTION_KEY");
  if (!value || !/^[a-f0-9]{64}$/i.test(value)) {
    throw new BadRequestException(
      "DATA_ENCRYPTION_KEY deve conter 64 caracteres hexadecimais",
    );
  }
  return Buffer.from(value, "hex");
}
