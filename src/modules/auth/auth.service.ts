import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PapelUsuario, Prisma } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import * as argon2 from "argon2";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { PrismaService } from "../../database/prisma.service";
import {
  AuthenticatedUser,
  LoginResult,
  RefreshTokenPayload,
} from "./auth.types";

interface AccessTokenPayload {
  sub: string;
  restauranteId: string;
  papel: PapelUsuario;
  sid: string;
  typ: "access";
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(
    restauranteId: string,
    email: string,
    password: string,
  ): Promise<LoginResult> {
    const usuario = await this.prisma.withTenant(restauranteId, (transaction) =>
      transaction.usuario.findFirst({
        where: {
          restauranteId,
          email: email.trim().toLowerCase(),
          ativo: true,
          restaurante: { ativo: true },
        },
        select: {
          id: true,
          nome: true,
          email: true,
          senhaHash: true,
          papel: true,
        },
      }),
    );

    if (!usuario || !(await argon2.verify(usuario.senhaHash, password))) {
      throw new UnauthorizedException("E-mail ou senha inválidos");
    }

    const sessionId = randomUUID();
    const user: AuthenticatedUser = {
      id: usuario.id,
      nome: usuario.nome,
      email: usuario.email,
      papel: usuario.papel,
    };
    const [accessToken, refreshToken] = await Promise.all([
      this.signAccessToken(usuario, restauranteId, sessionId),
      this.signRefreshToken(usuario.id, restauranteId, sessionId),
    ]);
    const expiresAt = new Date(
      Date.now() + this.readTtlSeconds("JWT_REFRESH_TTL"),
    );

    await this.prisma.withTenant(restauranteId, async (transaction) => {
      const currentUser = await transaction.usuario.findFirst({
        where: {
          id: usuario.id,
          restauranteId,
          ativo: true,
          senhaHash: usuario.senhaHash,
          restaurante: { ativo: true },
        },
        select: { id: true },
      });
      if (!currentUser) {
        throw new UnauthorizedException("E-mail ou senha inválidos");
      }
      await transaction.sessaoUsuario.create({
        data: {
          id: sessionId,
          restauranteId,
          usuarioId: usuario.id,
          refreshTokenHash: this.hashToken(refreshToken),
          expiraEm: expiresAt,
        },
      });
    });

    return { accessToken, refreshToken, user };
  }

  async refresh(
    restauranteId: string,
    refreshToken: string,
  ): Promise<LoginResult> {
    const payload = await this.verifyRefreshToken(refreshToken);
    if (payload.restauranteId !== restauranteId) {
      throw new UnauthorizedException("Sessão inválida");
    }

    return this.prisma.withTenant(restauranteId, async (transaction) => {
      const session = await transaction.sessaoUsuario.findFirst({
        where: {
          id: payload.sid,
          restauranteId,
          usuarioId: payload.sub,
          revogadaEm: null,
          expiraEm: { gt: new Date() },
        },
        include: { usuario: true },
      });

      if (
        !session ||
        !this.matchesTokenHash(refreshToken, session.refreshTokenHash) ||
        !session.usuario.ativo
      ) {
        throw new UnauthorizedException("Sessão inválida ou expirada");
      }

      const nextSessionId = randomUUID();
      const usuario = session.usuario;
      const [accessToken, nextRefreshToken] = await Promise.all([
        this.signAccessToken(usuario, restauranteId, nextSessionId),
        this.signRefreshToken(usuario.id, restauranteId, nextSessionId),
      ]);
      const now = new Date();
      const expiresAt = new Date(
        now.getTime() + this.readTtlSeconds("JWT_REFRESH_TTL"),
      );

      await transaction.sessaoUsuario.create({
        data: {
          id: nextSessionId,
          restauranteId,
          usuarioId: usuario.id,
          refreshTokenHash: this.hashToken(nextRefreshToken),
          expiraEm: expiresAt,
        },
      });
      const rotation = await transaction.sessaoUsuario.updateMany({
        where: {
          id: session.id,
          restauranteId,
          refreshTokenHash: session.refreshTokenHash,
          revogadaEm: null,
        },
        data: { revogadaEm: now, rotacionadaParaId: nextSessionId },
      });
      if (rotation.count !== 1) {
        throw new UnauthorizedException("Sessão já utilizada");
      }

      return {
        accessToken,
        refreshToken: nextRefreshToken,
        user: {
          id: usuario.id,
          nome: usuario.nome,
          email: usuario.email,
          papel: usuario.papel,
        },
      };
    });
  }

  async logout(restauranteId: string, refreshToken?: string): Promise<void> {
    if (!refreshToken) {
      return;
    }

    const payload = await this.verifyRefreshToken(refreshToken);
    if (payload.restauranteId !== restauranteId) {
      throw new UnauthorizedException("Sessão inválida");
    }

    await this.prisma.withTenant(restauranteId, async (transaction) => {
      const session = await transaction.sessaoUsuario.findFirst({
        where: {
          id: payload.sid,
          restauranteId,
          usuarioId: payload.sub,
          revogadaEm: null,
        },
      });
      if (!session) {
        return;
      }
      if (!this.matchesTokenHash(refreshToken, session.refreshTokenHash)) {
        throw new UnauthorizedException("Sessão inválida");
      }
      await transaction.sessaoUsuario.update({
        where: { id: session.id },
        data: { revogadaEm: new Date() },
      });
    });
  }

  private async signAccessToken(
    user: { id: string; papel: PapelUsuario },
    restauranteId: string,
    sessionId: string,
  ): Promise<string> {
    const payload: AccessTokenPayload = {
      sub: user.id,
      restauranteId,
      papel: user.papel,
      sid: sessionId,
      typ: "access",
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>("JWT_ACCESS_SECRET"),
      expiresIn: this.readTtlSeconds("JWT_ACCESS_TTL"),
      issuer: this.config.get<string>("JWT_ISSUER", "saasfood-api"),
      audience: this.config.get<string>("JWT_AUDIENCE", "saasfood-clients"),
    });
  }

  private async signRefreshToken(
    usuarioId: string,
    restauranteId: string,
    sessionId: string,
  ): Promise<string> {
    const payload: RefreshTokenPayload = {
      sub: usuarioId,
      restauranteId,
      sid: sessionId,
      typ: "refresh",
    };
    return this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>("JWT_REFRESH_SECRET"),
      expiresIn: this.readTtlSeconds("JWT_REFRESH_TTL"),
      issuer: this.config.get<string>("JWT_ISSUER", "saasfood-api"),
      audience: this.config.get<string>("JWT_AUDIENCE", "saasfood-clients"),
    });
  }

  private async verifyRefreshToken(
    token: string,
  ): Promise<RefreshTokenPayload> {
    const secret = this.config.getOrThrow<string>("JWT_REFRESH_SECRET");
    const issuer = this.config.get<string>("JWT_ISSUER", "saasfood-api");
    const audience = this.config.get<string>(
      "JWT_AUDIENCE",
      "saasfood-clients",
    );
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret,
        issuer,
        audience,
      });
    } catch {
      throw new UnauthorizedException("Refresh token inválido ou expirado");
    }

    if (
      payload.typ !== "refresh" ||
      !payload.sub ||
      !payload.restauranteId ||
      !payload.sid
    ) {
      throw new UnauthorizedException("Refresh token inválido");
    }
    return payload;
  }

  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private matchesTokenHash(token: string, storedHash: string): boolean {
    const expected = Buffer.from(storedHash, "hex");
    const actual = Buffer.from(this.hashToken(token), "hex");
    return (
      expected.length === actual.length && timingSafeEqual(expected, actual)
    );
  }

  private readTtlSeconds(key: string): number {
    const value = this.config.getOrThrow<string>(key);
    const match = /^([1-9]\d*)(s|m|h|d)$/.exec(value);
    if (!match) {
      throw new Error(`Configuração ${key} inválida`);
    }
    const amount = Number(match[1]);
    const unitSeconds: Record<string, number> = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
    };
    return amount * unitSeconds[match[2]];
  }
}
