import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as cookieParser from 'cookie-parser';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // El JWT viaja en una cookie httpOnly (ver auth.controller.ts) -- el
  // navegador solo la manda de vuelta a un origen explícito con
  // `credentials: true`, nunca a un wildcard. WEB_ORIGIN por env porque el
  // puerto/dominio del frontend cambia entre dev y producción.
  app.enableCors({ origin: process.env.WEB_ORIGIN ?? 'http://localhost:3002', credentials: true });
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
