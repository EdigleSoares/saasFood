import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { TenantResolutionMiddleware } from "./modules/tenancy/tenant-resolution.middleware";

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const tenantMiddleware = app.get(TenantResolutionMiddleware);
  const apiPrefix = config.get<string>("API_PREFIX", "api/v1");
  const port = config.get<number>("PORT", 3000);
  const allowedOrigins = config
    .get<string>("FRONTEND_ORIGINS", "http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.use(helmet());
  app.use(cookieParser());
  app.use(tenantMiddleware.use.bind(tenantMiddleware));
  app.setGlobalPrefix(apiPrefix);
  app.enableCors({
    credentials: true,
    origin: allowedOrigins,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle("SaaS Food API")
    .setDescription("API do Micro-SaaS Food Service")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(`${apiPrefix}/docs`, app, document);

  await app.listen(port, "0.0.0.0");
}

void bootstrap();
