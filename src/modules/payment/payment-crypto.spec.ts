import { ConfigService } from "@nestjs/config";
import { decryptPaymentSecret, encryptPaymentSecret } from "./payment-crypto";

describe("payment secret encryption", () => {
  const config = {
    get: jest
      .fn()
      .mockReturnValue(
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      ),
  } as unknown as ConfigService;

  it("encrypts and decrypts payment credentials without storing plaintext", () => {
    const encrypted = encryptPaymentSecret("manual-pix-secret", config);

    expect(encrypted).not.toContain("manual-pix-secret");
    expect(decryptPaymentSecret(encrypted, config)).toBe("manual-pix-secret");
  });

  it("rejects a credential whose authentication tag has been tampered with", () => {
    const encrypted = encryptPaymentSecret("asaas-api-key", config);
    const parts = encrypted.split(".");
    parts[2] = Buffer.from("incorrect-tag").toString("base64url");

    expect(() => decryptPaymentSecret(parts.join("."), config)).toThrow(
      "Não foi possível descriptografar a credencial de pagamento",
    );
  });
});
