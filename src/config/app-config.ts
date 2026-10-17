import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type Environment = 'development' | 'test' | 'production';

const ENVIRONMENTS: readonly Environment[] = ['development', 'test', 'production'];

export interface SwaggerConfig {
  enabled: boolean;
  /** Basic auth credentials; required whenever Swagger is enabled in production. */
  credentials?: { user: string; password: string };
}

export interface AppConfig {
  environment: Environment;
  port: number;
  databaseUrl: string;
  swagger: SwaggerConfig;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Loads `.env` from the working directory without overriding variables already set. */
export function loadEnvFile(path = resolve(process.cwd(), '.env')): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

/**
 * Builds the configuration from environment variables and fails fast on anything
 * missing. In `test` the database is always `DATABASE_URL_TEST`, so tests can
 * never touch another database.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = env.NODE_ENV as Environment;
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`NODE_ENV must be one of ${ENVIRONMENTS.join(', ')}; got "${env.NODE_ENV ?? ''}"`);
  }

  const databaseUrl = required(env, environment === 'test' ? 'DATABASE_URL_TEST' : 'DATABASE_URL');

  return {
    environment,
    port: Number(env.PORT ?? 3000),
    databaseUrl,
    swagger: swaggerConfig(environment, env),
  };
}

function swaggerConfig(environment: Environment, env: NodeJS.ProcessEnv): SwaggerConfig {
  if (environment !== 'production') return { enabled: true };
  if (env.SWAGGER_ENABLED !== 'true') return { enabled: false };

  return {
    enabled: true,
    credentials: { user: required(env, 'SWAGGER_USER'), password: required(env, 'SWAGGER_PASSWORD') },
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}
