/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  transform: {},
  testMatch: ['**/src/__tests__/**/*.test.js'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/migrations/**',
    '!src/__tests__/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  testTimeout: 30000,
};
