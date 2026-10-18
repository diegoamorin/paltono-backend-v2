/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.spec\\.ts$',
  // Agent worktrees live under .claude/; their copies of the specs must not run here.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/\\.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/\\.claude/'],
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/support/load-env.ts'],
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  maxWorkers: 1,
  testTimeout: 30000,
};
