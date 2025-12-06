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
- `ADMIN_API_KEY` - Your admin authentication key (63-character secure string)
- `DISCORD_API_TOKEN` - Your Discord bot token
- `OPENROUTER_API_KEY` - OpenRouter API key for Claude
- `TAVILY_API_KEY` - Tavily API key for web search

#### Optional Variables
- `ERC8004_CONTRACT_ADDRESS` - ERC-8004 contract address (default: 0x0000...)
- `GITHUB_TOKEN` - GitHub personal access token
- `COINMARKETCAP_API_KEY` - CoinMarketCap API key

### X402 Payment System

**🎉 自動設定で簡単！設定不要で動作します**

#### 仕組み

支払いシステムはRailway環境を自動検出し、すぐに使えます：

1. **自動URL検出**: Railwayの環境変数から自動的にURLを生成
2. **支払いページ**: 別リポジトリでVercel/Netlifyにデプロイ
   - 📁 **[x402payment-page](https://github.com/cipherwebllc/x402peyment-page)**
3. **MetaMask連携**: ワンクリックでウォレット接続・支払い
4. **自動検証**: ブロックチェーン上でトランザクションを自動確認

#### ユーザー体験の流れ

1. **ユーザーが質問**
2. **Botが支払いリンクを表示**:
   ```
   💰 0.1 USDC の支払いが必要です

   👉 <a href="https://x402payment.vercel.app/pay?user=123">支払いページへ</a>

   💡 対応ウォレット: MetaMask / Coinbase / Rabby など
   ```
3. **リンクをクリック** → 支払いページが開く
4. **ウォレットを選択**:
   - 🦊 MetaMask
   - 🔗 WalletConnect（開発中）
   - 💙 Coinbase Wallet
   - 🐰 Rabby Wallet
5. **ウォレット接続** → 自動的に Base Sepolia に切り替え
6. **0.1 USDC 支払い** → トランザクション確認
7. **「支払いました」** または txハッシュ送信
8. **Bot が自動検証** → 質問に回答 ✨

#### 技術仕様

| 項目 | 詳細 |
|------|------|
| **Network** | Base Sepolia (テストネット) |
| **Token** | USDC (`0x036CbD...`) |
| **Amount** | 0.1 USDC = 1 クレジット |
| **Payment Page** | [x402payment-page](https://github.com/cipherwebllc/x402peyment-page) (Vercel/Netlify) |
| **Verification** | Ethers.js v6 でブロックチェーン検証 |

#### 管理者機能

管理者としてログインすると、支払いをバイパスできます：

```
あなた: [63文字の管理者認証キー]
Bot: 🔓 管理者としてログインしました
```

環境変数 `ADMIN_API_KEY` に63文字のランダムキーを設定してください。

## Configuration

Customize your project by modifying:

- `src/index.ts` - Main entry point
- `src/character.ts` - Character definition
