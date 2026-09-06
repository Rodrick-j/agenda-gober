import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Cabeceras de seguridad HTTP (HSTS, X-Content-Type-Options, sin
  // X-Powered-By, etc.). La API es JSON puro: no sirve HTML, así que la CSP
  // por defecto de helmet no molesta a nadie.
  app.use(helmet());
  // Acepta uno o varios orígenes (staging + prod + previews) separados por
  // coma. credentials: true no admite '*' -- el navegador rechaza mandar la
  // cookie httpOnly del login a un wildcard.
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:3002')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins, credentials: true });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
