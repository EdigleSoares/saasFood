import { SetMetadata } from "@nestjs/common";
import { PapelUsuario } from "@prisma/client";

export const ROLES_KEY = "saasfood:roles";
export const Roles = (...roles: PapelUsuario[]) =>
  SetMetadata(ROLES_KEY, roles);
