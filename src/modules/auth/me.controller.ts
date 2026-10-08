import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthenticatedRequest } from "./auth.types";
import { JwtAccessGuard } from "./jwt-access.guard";

@ApiTags("Auth")
@ApiBearerAuth()
@Controller("me")
@UseGuards(JwtAccessGuard)
export class MeController {
  @Get()
  @ApiOperation({ summary: "Retorna a identidade da sessão autenticada" })
  getCurrentUser(@Req() request: AuthenticatedRequest) {
    return request.user;
  }
}
