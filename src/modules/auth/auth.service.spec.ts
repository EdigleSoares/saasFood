import { UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PapelUsuario } from "@prisma/client";
import * as argon2 from "argon2";
import { createHash } from "node:crypto";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../../database/prisma.service";
import { AuthService } from "./auth.service";

describe("AuthService", () => {
  const user = {
    id: "user-id",
    nome: "Dona Maria",
    email: "maria@example.com",
    senhaHash: "",
    papel: PapelUsuario.OWNER,
  };
  const transaction = {
    usuario: {
      findFirst: jest.fn(),
    },
    sessaoUsuario: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
  };
  const prisma = {
    withTenant: jest.fn(
      (_tenantId: string, operation: (tx: typeof transaction) => unknown) =>
        operation(transaction),
    ),
  } as unknown as PrismaService;
  const jwt = {
    signAsync: jest.fn(),
    verifyAsync: jest.fn(),
  } as unknown as JwtService;
  const config = {
    getOrThrow: jest.fn((key: string) => {
      const values: Record<string, string> = {
        JWT_ACCESS_SECRET: "access-secret",
        JWT_REFRESH_SECRET: "refresh-secret",
        JWT_ACCESS_TTL: "15m",
        JWT_REFRESH_TTL: "30d",
      };
      return values[key];
    }),
    get: jest.fn((_key: string, fallback: string) => fallback),
  } as unknown as ConfigService;
  const service = new AuthService(prisma, jwt, config);

  beforeEach(async () => {
    jest.clearAllMocks();
    user.senhaHash = await argon2.hash("CorrectPass123");
    transaction.usuario.findFirst.mockResolvedValue({ ...user });
    transaction.sessaoUsuario.create.mockResolvedValue({});
    transaction.sessaoUsuario.findFirst.mockResolvedValue(null);
    transaction.sessaoUsuario.update.mockResolvedValue({});
    transaction.sessaoUsuario.updateMany.mockResolvedValue({ count: 1 });
    (jwt.signAsync as jest.Mock)
      .mockResolvedValueOnce("access-token")
      .mockResolvedValueOnce("refresh-token");
  });

  it("authenticates within the tenant and stores only a refresh-token hash", async () => {
    const result = await service.login(
      "restaurant-id",
      " MARIA@EXAMPLE.COM ",
      "CorrectPass123",
    );

    expect(prisma.withTenant).toHaveBeenNthCalledWith(
      1,
      "restaurant-id",
      expect.any(Function),
    );
    expect(prisma.withTenant).toHaveBeenCalledTimes(2);
    expect(transaction.usuario.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          restauranteId: "restaurant-id",
          email: "maria@example.com",
        }),
      }),
    );
    expect(result).toMatchObject({
      accessToken: "access-token",
      refreshToken: "refresh-token",
      user: { id: "user-id", papel: PapelUsuario.OWNER },
    });
    expect(transaction.sessaoUsuario.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          restauranteId: "restaurant-id",
          usuarioId: "user-id",
          refreshTokenHash: expect.not.stringContaining("refresh-token"),
        }),
      }),
    );
  });

  it("does not authenticate an invalid password", async () => {
    await expect(
      service.login("restaurant-id", "maria@example.com", "wrong-password"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(transaction.sessaoUsuario.create).not.toHaveBeenCalled();
  });

  it("rejects a refresh token issued for another tenant", async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
      sub: "user-id",
      restauranteId: "another-restaurant",
      sid: "session-id",
      typ: "refresh",
    });

    await expect(
      service.refresh("restaurant-id", "valid-token"),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(prisma.withTenant).not.toHaveBeenCalled();
  });

  it("rotates refresh tokens only once", async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
      sub: "user-id",
      restauranteId: "restaurant-id",
      sid: "session-id",
      typ: "refresh",
    });
    transaction.sessaoUsuario.findFirst.mockResolvedValue({
      id: "session-id",
      restauranteId: "restaurant-id",
      usuarioId: "user-id",
      refreshTokenHash: require("node:crypto")
        .createHash("sha256")
        .update("valid-token")
        .digest("hex"),
      revogadaEm: null,
      expiraEm: new Date(Date.now() + 60_000),
      usuario: { ...user, ativo: true },
    });
    (jwt.signAsync as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce("next-access")
      .mockResolvedValueOnce("next-refresh");
    transaction.sessaoUsuario.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      service.refresh("restaurant-id", "valid-token"),
    ).rejects.toThrow("Sessão já utilizada");
    expect(transaction.sessaoUsuario.create).toHaveBeenCalled();
    expect(transaction.sessaoUsuario.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "session-id",
          revogadaEm: null,
        }),
      }),
    );
  });

  it("issues a new session and revokes the previous one on refresh", async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
      sub: "user-id",
      restauranteId: "restaurant-id",
      sid: "session-id",
      typ: "refresh",
    });
    transaction.sessaoUsuario.findFirst.mockResolvedValue({
      id: "session-id",
      restauranteId: "restaurant-id",
      usuarioId: "user-id",
      refreshTokenHash: createHash("sha256")
        .update("valid-token")
        .digest("hex"),
      revogadaEm: null,
      expiraEm: new Date(Date.now() + 60_000),
      usuario: { ...user, ativo: true },
    });
    (jwt.signAsync as jest.Mock)
      .mockReset()
      .mockResolvedValueOnce("next-access")
      .mockResolvedValueOnce("next-refresh");
    transaction.sessaoUsuario.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      service.refresh("restaurant-id", "valid-token"),
    ).resolves.toMatchObject({
      accessToken: "next-access",
      refreshToken: "next-refresh",
    });
    expect(transaction.sessaoUsuario.create).toHaveBeenCalled();
    expect(transaction.sessaoUsuario.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          rotacionadaParaId: expect.any(String),
          revogadaEm: expect.any(Date),
        }),
      }),
    );
  });

  it("revokes an active session on logout", async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
      sub: "user-id",
      restauranteId: "restaurant-id",
      sid: "session-id",
      typ: "refresh",
    });
    transaction.sessaoUsuario.findFirst.mockResolvedValue({
      id: "session-id",
      restauranteId: "restaurant-id",
      usuarioId: "user-id",
      refreshTokenHash: createHash("sha256")
        .update("valid-token")
        .digest("hex"),
      revogadaEm: null,
    });

    await expect(
      service.logout("restaurant-id", "valid-token"),
    ).resolves.toBeUndefined();
    expect(transaction.sessaoUsuario.update).toHaveBeenCalledWith({
      where: { id: "session-id" },
      data: { revogadaEm: expect.any(Date) },
    });
  });
});
