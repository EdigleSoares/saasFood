import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PapelUsuario } from "@prisma/client";
import { JwtService } from "@nestjs/jwt";
import { JwtAccessGuard } from "./jwt-access.guard";

describe("JwtAccessGuard", () => {
  const jwt = {
    verifyAsync: jest.fn(),
  } as unknown as JwtService;
  const config = {
    getOrThrow: jest.fn().mockReturnValue("access-secret"),
    get: jest.fn((_key: string, fallback: string) => fallback),
  } as unknown as ConfigService;
  const guard = new JwtAccessGuard(jwt, config);

  function executionContext(
    request: Record<string, unknown>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("accepts an access token only for its resolved tenant", async () => {
    const request = {
      headers: { authorization: "Bearer token" },
      tenant: { id: "11111111-1111-4111-8111-111111111111" },
    };
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
      sub: "22222222-2222-4222-8222-222222222222",
      restauranteId: "11111111-1111-4111-8111-111111111111",
      sid: "33333333-3333-4333-8333-333333333333",
      papel: PapelUsuario.OWNER,
      typ: "access",
    });

    await expect(guard.canActivate(executionContext(request))).resolves.toBe(
      true,
    );
    expect(request).toHaveProperty("user", {
      id: "22222222-2222-4222-8222-222222222222",
      restauranteId: "11111111-1111-4111-8111-111111111111",
      papel: PapelUsuario.OWNER,
      sessionId: "33333333-3333-4333-8333-333333333333",
    });
  });

  it("rejects missing bearer credentials", async () => {
    await expect(
      guard.canActivate(
        executionContext({
          headers: {},
          tenant: { id: "11111111-1111-4111-8111-111111111111" },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a valid token bound to a different tenant", async () => {
    (jwt.verifyAsync as jest.Mock).mockResolvedValue({
      sub: "22222222-2222-4222-8222-222222222222",
      restauranteId: "44444444-4444-4444-8444-444444444444",
      sid: "33333333-3333-4333-8333-333333333333",
      papel: PapelUsuario.OWNER,
      typ: "access",
    });

    await expect(
      guard.canActivate(
        executionContext({
          headers: { authorization: "Bearer token" },
          tenant: { id: "11111111-1111-4111-8111-111111111111" },
        }),
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
