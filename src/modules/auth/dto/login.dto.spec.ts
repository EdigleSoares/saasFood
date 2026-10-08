import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { LoginDto } from "./login.dto";

describe("LoginDto", () => {
  it("normalizes email and accepts valid credentials", async () => {
    const dto = plainToInstance(LoginDto, {
      email: "  OWNER@EXAMPLE.COM ",
      password: "valid-password",
    });

    expect(dto.email).toBe("owner@example.com");
    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it("rejects malformed email and empty password", async () => {
    const dto = plainToInstance(LoginDto, {
      email: "not-an-email",
      password: "",
      isAdmin: true,
    });
    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(["email", "password"]),
    );
  });
});
