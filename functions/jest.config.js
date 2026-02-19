/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          // Override NodeNext module for Jest (CommonJS compatible)
          module: 'CommonJS',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: true,
          noUnusedLocals: false, // Relax for test files
        },
      },
    ],
  },
  testMatch: ['**/src/**/*.test.ts'],
  moduleNameMapper: {
    // Strip .js extensions from NodeNext-style imports so Jest can resolve .ts files
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
