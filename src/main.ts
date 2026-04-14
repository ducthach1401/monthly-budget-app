import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  const port = Number(process.env.APP_PORT ?? process.env.PORT ?? 3000);
  const host = process.env.APP_HOST ?? '0.0.0.0';
  const publicHost = process.env.PUBLIC_HOST ?? 'localhost';

  await app.listen(port, host);
  console.log(`🚀 Server running at http://${publicHost}:${port}`);
}
void bootstrap();
