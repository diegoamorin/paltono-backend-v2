import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { APP_OPTIONS, configureApp } from './app.setup';
import { loadConfig, loadEnvFile } from './config/app-config';

async function bootstrap() {
  loadEnvFile();
  const config = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule.register(config), APP_OPTIONS);
  configureApp(app, config);
  app.enableShutdownHooks();
  await app.listen(config.port);
}

void bootstrap();
