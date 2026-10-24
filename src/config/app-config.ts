import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { testDatabaseUrl } from '../database/test-database-url';

export type Environment = 'development' | 'test' | 'production';

const ENVIRONMENTS: readonly Environment[] = ['development', 'test', 'production'];

export interface SwaggerConfig {
  enabled: boolean;
  /** Basic auth credentials; required whenever Swagger is enabled in production. */
  credentials?: { user: string; password: string };
}

export interface AuthConfig {
  /** HMAC key that signs access tokens. */
  accessTokenSecret: string;
  accessTokenTtlMs: number;
  /** Absolute lifetime of a renewable session. */
  sessionTtlMs: number;
  emailVerificationTtlMs: number;
  passwordResetTtlMs: number;
  emailChangeTtlMs: number;
  /** Requests per minute and client address on each rate-limited route. */
  rateLimit: number;
}

export interface MailConfig {
  /** Without a key, outside production, emails are written to the log instead of sent. */
  resendApiKey?: string;
  from: string;
}

/** Where uploaded images are stored (ADR 0005): Cloudflare R2 in production, a local folder elsewhere. */
export type ImageStorageConfig =
  | {
      /** A folder that the backend itself serves under `/images`. */
      kind: 'local';
      directory: string;
    }
  | {
      /** A Cloudflare R2 bucket, reached through its S3-compatible API and served from the public base URL. */
      kind: 'r2';
      endpoint: string;
      bucket: string;
      accessKeyId: string;
      secretAccessKey: string;
    };

export interface ImagesConfig {
  /** Public base of uploaded images, ending in `/`: an image's URL is this base plus its storage key. */
  publicBaseUrl: string;
  storage: ImageStorageConfig;
}

export interface AppConfig {
  environment: Environment;
  port: number;
  databaseUrl: string;
  swagger: SwaggerConfig;
  auth: AuthConfig;
  mail: MailConfig;
  images: ImagesConfig;
  /** Base URL of the main app, `paltono.com`, ending in `/`: the only app where accounts are used (ADR 0002). */
  mainAppUrl: string;
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Placeholder signing key outside production, so development and tests need no setup. */
const DEVELOPMENT_ACCESS_TOKEN_SECRET = 'development-only-access-token-secret';

export const APP_CONFIG = Symbol('APP_CONFIG');

/** Loads `.env` from the working directory without overriding variables already set. */
export function loadEnvFile(path = resolve(process.cwd(), '.env')): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

/**
 * Builds the configuration from environment variables and fails fast on anything
 * missing. In `test` the database is always the test database (`DATABASE_URL_TEST`,
 * suffixed in a linked worktree), so tests can never touch another database.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const environment = loadEnvironment(env);
  const port = Number(env.PORT ?? 3000);

  return {
    environment,
    port,
    databaseUrl:
      environment === 'test'
        ? testDatabaseUrl({ DATABASE_URL_TEST: required(env, 'DATABASE_URL_TEST') })!
        : required(env, 'DATABASE_URL'),
    swagger: swaggerConfig(environment, env),
    auth: authConfig(environment, env),
    mail: mailConfig(environment, env),
    images: imagesConfig(environment, env, port),
    mainAppUrl: mainAppUrl(environment, env),
  };
}

function authConfig(environment: Environment, env: NodeJS.ProcessEnv): AuthConfig {
  return {
    accessTokenSecret: requiredInProduction(environment, env, 'ACCESS_TOKEN_SECRET', DEVELOPMENT_ACCESS_TOKEN_SECRET),
    accessTokenTtlMs: positiveNumber(env, 'ACCESS_TOKEN_TTL_SECONDS', 15 * 60) * SECOND,
    sessionTtlMs: positiveNumber(env, 'SESSION_TTL_DAYS', 30) * DAY,
    emailVerificationTtlMs: positiveNumber(env, 'EMAIL_VERIFICATION_TTL_HOURS', 24) * HOUR,
    passwordResetTtlMs: positiveNumber(env, 'PASSWORD_RESET_TTL_MINUTES', 30) * MINUTE,
    emailChangeTtlMs: positiveNumber(env, 'EMAIL_CHANGE_TTL_MINUTES', 30) * MINUTE,
    rateLimit: positiveNumber(env, 'AUTH_RATE_LIMIT', 10),
  };
}

function mailConfig(environment: Environment, env: NodeJS.ProcessEnv): MailConfig {
  return {
    resendApiKey: environment === 'production' ? required(env, 'RESEND_API_KEY') : env.RESEND_API_KEY || undefined,
    // Resend's test sender outside production; the verified paltono.com domain in production.
    from: requiredInProduction(environment, env, 'MAIL_FROM', 'Paltono <onboarding@resend.dev>'),
  };
}

function mainAppUrl(environment: Environment, env: NodeJS.ProcessEnv): string {
  const url = requiredInProduction(environment, env, 'MAIN_APP_URL', 'http://localhost:5173');
  if (!/^https?:\/\/[^/]/.test(url)) throw new Error(`MAIN_APP_URL must be an http(s) URL; got "${url}"`);
  return url.endsWith('/') ? url : `${url}/`;
}

/** The folder of locally stored images when `IMAGE_STORAGE_DIRECTORY` is unset; ignored by git. */
export const DEFAULT_IMAGE_STORAGE_DIRECTORY = 'storage/images';

function imagesConfig(environment: Environment, env: NodeJS.ProcessEnv, port: number): ImagesConfig {
  const base = requiredInProduction(environment, env, 'IMAGE_PUBLIC_BASE_URL', `http://localhost:${port}/images/`);
  if (!/^https?:\/\/[^/]/.test(base)) throw new Error(`IMAGE_PUBLIC_BASE_URL must be an http(s) URL; got "${base}"`);

  return {
    publicBaseUrl: base.endsWith('/') ? base : `${base}/`,
    storage: imageStorageConfig(environment, env),
  };
}

function imageStorageConfig(environment: Environment, env: NodeJS.ProcessEnv): ImageStorageConfig {
  if (environment !== 'production') {
    return { kind: 'local', directory: resolve(env.IMAGE_STORAGE_DIRECTORY || DEFAULT_IMAGE_STORAGE_DIRECTORY) };
  }

  return {
    kind: 'r2',
    endpoint: required(env, 'R2_ENDPOINT'),
    bucket: required(env, 'R2_BUCKET'),
    accessKeyId: required(env, 'R2_ACCESS_KEY_ID'),
    secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY'),
  };
}

/** A variable required in production that falls back to a development value elsewhere. */
function requiredInProduction(environment: Environment, env: NodeJS.ProcessEnv, name: string, value: string): string {
  return environment === 'production' ? required(env, name) : env[name] || value;
}

function positiveNumber(env: NodeJS.ProcessEnv, name: string, value: number): number {
  if (!env[name]) return value;
  const number = Number(env[name]);
  if (!(number > 0)) throw new Error(`${name} must be a positive number; got "${env[name]}"`);
  return number;
}

/** Reads `NODE_ENV` alone, for commands that must refuse an environment before configuring anything. */
export function loadEnvironment(env: NodeJS.ProcessEnv = process.env): Environment {
  const environment = env.NODE_ENV as Environment;
  if (!ENVIRONMENTS.includes(environment)) {
    throw new Error(`NODE_ENV must be one of ${ENVIRONMENTS.join(', ')}; got "${env.NODE_ENV ?? ''}"`);
  }
  return environment;
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
