# Project Starter

This is the starter template for ElizaOS projects.

## Features

- Pre-configured project structure for ElizaOS development
- Comprehensive testing setup with component and e2e tests
- Default character configuration with plugin integration
- Example service, action, and provider implementations
- TypeScript configuration for optimal developer experience
- Built-in documentation and examples

## Getting Started

```bash
# Create a new project
elizaos create --type project my-project
# Dependencies are automatically installed and built

# Navigate to the project directory
cd my-project

# Start development immediately
elizaos dev
```

## Development

```bash
# Start development with hot-reloading (recommended)
elizaos dev

# OR start without hot-reloading
elizaos start
# Note: When using 'start', you need to rebuild after changes:
# bun run build

# Test the project
elizaos test
```

## Testing

ElizaOS employs a dual testing strategy:

1. **Component Tests** (`src/__tests__/*.test.ts`)

   - Run with Bun's native test runner
   - Fast, isolated tests using mocks
   - Perfect for TDD and component logic

2. **E2E Tests** (`src/__tests__/e2e/*.e2e.ts`)
   - Run with ElizaOS custom test runner
   - Real runtime with actual database (PGLite)
   - Test complete user scenarios

### Test Structure

```
src/
  __tests__/              # All tests live inside src
    *.test.ts            # Component tests (use Bun test runner)
    e2e/                 # E2E tests (use ElizaOS test runner)
      project-starter.e2e.ts  # E2E test suite
      README.md          # E2E testing documentation
  index.ts               # Export tests here: tests: [ProjectStarterTestSuite]
```

### Running Tests

- `elizaos test` - Run all tests (component + e2e)
- `elizaos test component` - Run only component tests
- `elizaos test e2e` - Run only E2E tests

### Writing Tests

Component tests use bun:test:

```typescript
// Unit test example (__tests__/config.test.ts)
describe('Configuration', () => {
  it('should load configuration correctly', () => {
    expect(config.debug).toBeDefined();
  });
});

// Integration test example (__tests__/integration.test.ts)
describe('Integration: Plugin with Character', () => {
  it('should initialize character with plugins', async () => {
    // Test interactions between components
  });
});
```

E2E tests use ElizaOS test interface:

```typescript
// E2E test example (e2e/project.test.ts)
export class ProjectTestSuite implements TestSuite {
  name = 'project_test_suite';
  tests = [
    {
      name: 'project_initialization',
      fn: async (runtime) => {
        // Test project in a real runtime
      },
    },
  ];
}

export default new ProjectTestSuite();
```

The test utilities in `__tests__/utils/` provide helper functions to simplify writing tests.

## Railway Deployment

### Environment Variables for Railway

When deploying to Railway, set the following environment variables in your Railway dashboard:

#### Required Variables
- `PAYMENT_BASE_URL` - Your Railway app URL (e.g., `https://your-app.up.railway.app`)
- `ADMIN_API_KEY` - Your admin authentication key (63-character secure string)
- `DISCORD_API_TOKEN` - Your Discord bot token
- `OPENROUTER_API_KEY` - OpenRouter API key for Claude
- `TAVILY_API_KEY` - Tavily API key for web search

#### Optional Variables
- `ERC8004_CONTRACT_ADDRESS` - ERC-8004 contract address (default: 0x0000...)
- `GITHUB_TOKEN` - GitHub personal access token
- `COINMARKETCAP_API_KEY` - CoinMarketCap API key

### X402 Payment System Setup

The payment system automatically adapts to the environment:

**Local Development:**
- Payment links use `http://localhost:3001`
- X402 payment server runs on port 3001

**Railway Production:**
- Set `PAYMENT_BASE_URL` to your Railway public URL
- Payment links will use your production domain
- Example: `https://your-app.up.railway.app/pay?user=...`

**Important:** Without `PAYMENT_BASE_URL` set, Railway users will see localhost links and payments won't work.

## Configuration

Customize your project by modifying:

- `src/index.ts` - Main entry point
- `src/character.ts` - Character definition
