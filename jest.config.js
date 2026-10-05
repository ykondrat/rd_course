module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/dist-test/test/**/*.test.js'],
  transform: {},
  reporters: ['default'],
  testTimeout: 120000,
  maxWorkers: 1,
  verbose: true,
};
