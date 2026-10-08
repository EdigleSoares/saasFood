import {
  BadRequestException,
  Injectable,
  NestMiddleware,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NextFunction, Response } from "express";
import { PrismaService } from "../../database/prisma.service";
import { TenantRequest } from "./tenant-request";

const RESERVED_SUBDOMAINS = new Set(["admin", "api", "docs", "mail", "www"]);

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async use(
    request: TenantRequest,
    _response: Response,
    next: NextFunction,
  ): Promise<void> {
    try {
      if (/\/webhooks\/asaas\/?$/.test(request.path)) {
        next();
        return;
      }
      const tenant = await this.resolveHost(request.hostname);
      if (tenant) {
        request.tenant = tenant;
      }
      next();
    } catch (error) {
      next(error);
    }
  }

  async resolveHost(hostname: string) {
    const baseDomain = this.config
      .getOrThrow<string>("PUBLIC_BASE_DOMAIN")
      .trim()
      .toLowerCase()
      .replace(/^\.+|\.+$/g, "");
    const host = hostname.trim().toLowerCase().replace(/\.$/, "");

    if (host === baseDomain) {
      return undefined;
    }

    const suffix = `.${baseDomain}`;
    if (!host.endsWith(suffix)) {
      throw new BadRequestException(
        "Host não pertence ao domínio da aplicação",
      );
    }

    const slug = host.slice(0, -suffix.length);
    if (
      !slug ||
      slug.includes(".") ||
      !/^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/.test(slug) ||
      RESERVED_SUBDOMAINS.has(slug)
    ) {
      throw new BadRequestException("Subdomínio inválido");
    }

    const restaurante = await this.prisma.restaurante.findUnique({
      where: { slug },
      select: { id: true, slug: true, nome: true, ativo: true },
    });

    if (!restaurante || !restaurante.ativo) {
      throw new NotFoundException("Restaurante não encontrado");
    }

    return {
      id: restaurante.id,
      slug: restaurante.slug,
      nome: restaurante.nome,
    };
  }
}
