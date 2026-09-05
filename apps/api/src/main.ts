import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Abierto porque el frontend todavía no tiene un dominio fijo (dev en
  // localhost:3000). Restringir al origen real antes de producción.
  app.enableCors();
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();
  await app.listen(process.env.PORT ?? 3001);
}
bootstrap();
