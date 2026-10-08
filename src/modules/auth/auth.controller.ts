import {
  Body,
  Controller,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Request, Response } from "express";
import { TenantContext } from "../tenancy/tenant-request";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";

interface TenantAwareRequest extends Request {
  tenant?: TenantContext;
}

const REFRESH_COOKIE = "saasfood_refresh";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Post("login")
  @ApiOperation({ summary: "Autentica um usuário do restaurante" })
  @ApiBody({ type: LoginDto })
  async login(
    @Body() dto: LoginDto,
    @Req() request: TenantAwareRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tenant = this.requireTenant(request);
    const result = await this.authService.login(
      tenant.id,
      dto.email,
      dto.password,
    );
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("refresh")
  @ApiOperation({ summary: "Rotaciona a sessão usando o refresh cookie" })
  async refresh(
    @Req() request: TenantAwareRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tenant = this.requireTenant(request);
    const token = request.cookies?.[REFRESH_COOKIE];
    if (!token) {
      throw new UnauthorizedException("Refresh token ausente");
    }
    const result = await this.authService.refresh(tenant.id, token);
    this.setRefreshCookie(response, result.refreshToken);
    return { accessToken: result.accessToken, user: result.user };
  }

  @Post("logout")
  @ApiOperation({ summary: "Revoga a sessão atual" })
  async logout(
    @Req() request: TenantAwareRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const tenant = this.requireTenant(request);
    try {
      await this.authService.logout(
        tenant.id,
        request.cookies?.[REFRESH_COOKIE],
      );
      return { success: true };
    } finally {
      response.clearCookie(REFRESH_COOKIE, this.cookieOptions());
    }
  }

  private requireTenant(request: TenantAwareRequest): TenantContext {
    if (!request.tenant) {
      throw new UnauthorizedException("Subdomínio do restaurante obrigatório");
    }
    return request.tenant;
  }

  private setRefreshCookie(response: Response, token: string): void {
    response.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: this.refreshTtlMilliseconds(),
    });
  }

  private cookieOptions() {
    const domain = this.config.get<string>("COOKIE_DOMAIN")?.trim();
    const production = this.config.get<string>("NODE_ENV") === "production";
    return {
      httpOnly: true,
      secure: this.config.get<string>("COOKIE_SECURE") === "true" || production,
      sameSite: "lax" as const,
      path: "/api/v1/auth",
      ...(domain ? { domain } : {}),
    };
  }

  private refreshTtlMilliseconds(): number {
    const value = this.config.get<string>("JWT_REFRESH_TTL", "30d");
    const match = /^([1-9]\d*)(s|m|h|d)$/.exec(value);
    if (!match) {
      throw new Error("JWT_REFRESH_TTL inválido");
    }
    const unitMilliseconds: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    return Number(match[1]) * unitMilliseconds[match[2]];
  }
}
