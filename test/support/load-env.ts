import { loadEnvFile } from '../../src/config/app-config';

process.env.NODE_ENV = 'test';
loadEnvFile();
