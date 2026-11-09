/** @type {import('jest').Config} */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/.*\\.spec\\.ts$',
  // Agent worktrees live under .claude/; their copies of the specs must not run here.
  testPathIgnorePatterns: ['/node_modules/', '<rootDir>/\\.claude/'],
  modulePathIgnorePatterns: ['<rootDir>/\\.claude/'],
  // Transpile only, without type checking: `pnpm typecheck` checks the types.
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.jest.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/test/support/load-env.ts'],
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  maxWorkers: 1,
  testTimeout: 30000,
};
