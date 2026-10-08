import { PapelUsuario } from "@prisma/client";
import { Request } from "express";
import { TenantContext } from "../tenancy/tenant-request";

export interface AuthenticatedUser {
  id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
}

export interface AuthenticatedRequest extends Request, RequestWithTenant {
  user?: {
    id: string;
    restauranteId: string;
    papel: PapelUsuario;
    sessionId: string;
  };
}

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
}

export interface RequestWithTenant {
  tenant?: TenantContext;
}

export interface RefreshTokenPayload {
  sub: string;
  restauranteId: string;
  sid: string;
  typ: "refresh";
  iat?: number;
  exp?: number;
  iss?: string;
  aud?: string | string[];
}
