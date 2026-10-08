import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PapelUsuario } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { isUUID } from "class-validator";
import { AuthenticatedRequest } from "./auth.types";

interface AccessTokenPayload {
  sub: string;
  restauranteId: string;
  papel: PapelUsuario;
  sid: string;
  typ: "access";
}

@Injectable()
export class JwtAccessGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const tenant = request.tenant;
    const authorization = request.headers.authorization;
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!tenant || !token) {
      throw new UnauthorizedException("Autenticação obrigatória");
    }

    const payload = await this.verify(token);
    if (
      payload.typ !== "access" ||
      !isUUID(payload.sub) ||
      !isUUID(payload.restauranteId) ||
      !isUUID(payload.sid) ||
      payload.restauranteId !== tenant.id ||
      !Object.values(PapelUsuario).includes(payload.papel)
    ) {
      throw new UnauthorizedException("Token inválido para este restaurante");
    }

    request.user = {
      id: payload.sub,
      restauranteId: payload.restauranteId,
      papel: payload.papel,
      sessionId: payload.sid,
    };
    return true;
  }

  private async verify(token: string): Promise<AccessTokenPayload> {
    const secret = this.config.getOrThrow<string>("JWT_ACCESS_SECRET");
    const issuer = this.config.get<string>("JWT_ISSUER", "saasfood-api");
    const audience = this.config.get<string>(
      "JWT_AUDIENCE",
      "saasfood-clients",
    );
    try {
      return await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret,
        issuer,
        audience,
      });
    } catch {
      throw new UnauthorizedException("Access token inválido ou expirado");
    }
  }
}
