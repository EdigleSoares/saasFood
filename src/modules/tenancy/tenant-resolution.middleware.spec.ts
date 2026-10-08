import { BadRequestException, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Response } from "express";
import { PrismaService } from "../../database/prisma.service";
import { TenantRequest } from "./tenant-request";
import { TenantResolutionMiddleware } from "./tenant-resolution.middleware";

describe("TenantResolutionMiddleware", () => {
  const config = {
    getOrThrow: jest.fn().mockReturnValue("localhost"),
  } as unknown as ConfigService;
  const prisma = {
    restaurante: {
      findUnique: jest.fn(),
    },
  } as unknown as PrismaService;
  const middleware = new TenantResolutionMiddleware(config, prisma);
  const findUnique = prisma.restaurante.findUnique as jest.Mock;

  beforeEach(() => {
    findUnique.mockReset();
  });

  it("does not resolve a tenant for the base domain", async () => {
    await expect(middleware.resolveHost("localhost")).resolves.toBeUndefined();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("bypasses tenant resolution for the public Asaas webhook endpoint", async () => {
    const request = {
      path: "/api/v1/webhooks/asaas",
      hostname: "api.localhost",
    } as TenantRequest;
    const next = jest.fn();

    await middleware.use(request, {} as Response, next);

    expect(next).toHaveBeenCalledWith();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("resolves only active tenant subdomains", async () => {
    findUnique.mockResolvedValue({
      id: "restaurant-id",
      slug: "pizzaria-do-ze",
      nome: "Pizzaria do Zé",
      ativo: true,
    });

    await expect(
      middleware.resolveHost("pizzaria-do-ze.localhost"),
    ).resolves.toEqual({
      id: "restaurant-id",
      slug: "pizzaria-do-ze",
      nome: "Pizzaria do Zé",
    });
    expect(findUnique).toHaveBeenCalledWith({
      where: { slug: "pizzaria-do-ze" },
      select: { id: true, slug: true, nome: true, ativo: true },
    });
  });

  it("rejects hosts outside the configured base domain", async () => {
    await expect(
      middleware.resolveHost("tenant.example.com"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects nested and reserved subdomains", async () => {
    await expect(
      middleware.resolveHost("one.two.localhost"),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      middleware.resolveHost("api.localhost"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does not resolve inactive or unknown restaurants", async () => {
    findUnique.mockResolvedValue(null);
    await expect(
      middleware.resolveHost("unknown.localhost"),
    ).rejects.toBeInstanceOf(NotFoundException);

    findUnique.mockResolvedValue({
      id: "restaurant-id",
      slug: "closed",
      nome: "Closed",
      ativo: false,
    });
    await expect(
      middleware.resolveHost("closed.localhost"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
