import { Request } from "express";

export interface TenantContext {
  id: string;
  slug: string;
  nome: string;
}

export interface TenantRequest extends Request {
  tenant?: TenantContext;
}
