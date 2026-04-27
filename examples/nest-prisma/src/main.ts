import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS
  app.enableCors();

  // Mount Flowlib API under /flowlib/*
  const basePath = process.env.FLOWLIB_BASE_PATH || '/flowlib';
  app.setGlobalPrefix(basePath.replace(/^\//, ''));

  const port = parseInt(process.env.PORT || '3001', 10);
  await app.listen(port);

  console.log(`🚀 Acme SaaS API running on: http://localhost:${port}`);
  console.log(`   Flowlib API:  http://localhost:${port}${basePath}`);
}

void bootstrap();
