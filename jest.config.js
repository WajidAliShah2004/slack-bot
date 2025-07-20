module.exports = {
  // Test environment
  testEnvironment: 'node',
  
  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],
  
  // Test coverage
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/*.spec.js',
    '!src/database/seed.js',
    '!src/app.js'
  ],
  
  // Coverage thresholds
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 70,
      lines: 70,
      statements: 70
    }
  },
  
  // Setup files
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.js'],
  
  // Test timeout
  testTimeout: 10000,
  
  // Clear mocks between tests
  clearMocks: true,
  
  // Verbose output
  verbose: true,
  
  // Transform files
  transform: {},
  
  // Module file extensions
  moduleFileExtensions: ['js', 'json'],
  
  // Module name mapping
  moduleNameMapping: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  
  // Test path ignore patterns
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/coverage/'
  ],
  
  // Watch plugins
  watchPlugins: [
    'jest-watch-typeahead/filename',
    'jest-watch-typeahead/testname'
  ],
  
  // Global setup and teardown
  globalSetup: '<rootDir>/src/__tests__/globalSetup.js',
  globalTeardown: '<rootDir>/src/__tests__/globalTeardown.js',
  
  // Environment variables for tests
  setupFiles: ['<rootDir>/src/__tests__/env.js'],
  
  // Test results processor
  testResultsProcessor: 'jest-sonar-reporter',
  
  // Reporters
  reporters: [
    'default',
    ['jest-junit', {
      outputDirectory: 'coverage',
      outputName: 'junit.xml',
      classNameTemplate: '{classname}',
      titleTemplate: '{title}',
      ancestorSeparator: ' › ',
      usePathForSuiteName: true
    }]
  ]
}; 