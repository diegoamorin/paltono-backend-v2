import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { loadConfig, loadEnvFile } from '../config/app-config';
import { databaseOptions } from './database-options';

// Entry point for the TypeORM CLI (`pnpm migration:*`).
loadEnvFile();

export default new DataSource(databaseOptions(loadConfig().databaseUrl));
