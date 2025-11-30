# X402 Payment Page

Web3 wallet-connect payment page for X402 payment system.

## Features

- 🦊 **MetaMask Integration** - One-click wallet connection
- 🔄 **Auto Network Switch** - Automatically switches to Base Sepolia
- 💳 **One-Click Payment** - Send 0.1 USDC with a single click
- ✅ **Transaction Verification** - Real-time confirmation
- 📱 **Responsive Design** - Works on desktop and mobile
- 🎨 **Beautiful UI** - Modern gradient design

## Deployment

### Option 1: Vercel (Recommended)

1. **Install Vercel CLI:**
   ```bash
   npm i -g vercel
   ```

2. **Deploy:**
   ```bash
   cd payment-page
   vercel --prod
   ```

3. **Copy the URL:**
   ```
   https://your-project-name.vercel.app
   ```

4. **Set environment variable in Railway:**
   ```bash
   PAYMENT_PAGE_URL=https://your-project-name.vercel.app
   ```

### Option 2: Netlify

1. **Install Netlify CLI:**
   ```bash
   npm i -g netlify-cli
   ```

2. **Deploy:**
   ```bash
   cd payment-page
   netlify deploy --prod
   ```

3. **Copy the URL and set in Railway**

### Option 3: GitHub Pages

1. **Create a new repository** (e.g., `x402-payment`)

2. **Push payment page:**
   ```bash
   cd payment-page
   git init
   git add .
   git commit -m "Initial payment page"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/x402-payment.git
   git push -u origin main
   ```

3. **Enable GitHub Pages:**
   - Go to repository Settings
   - Pages → Source: main branch
   - Wait for deployment

4. **Copy URL:** `https://YOUR_USERNAME.github.io/x402-payment/`

## Configuration

### Smart Contract Addresses (Base Sepolia)

- **USDC Contract:** `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- **Receiver Address:** `0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb`
- **Network:** Base Sepolia (Chain ID: 84532)

### Customization

Edit `index.html` to customize:
- Colors and styling (CSS variables)
- Contract addresses
- Payment amount
- Network settings

## Testing

1. **Get Base Sepolia ETH:**
   - Visit https://www.coinbase.com/faucets/base-ethereum-goerli-faucet
   - Or use https://sepolia-faucet.pk910.de/

2. **Get Base Sepolia USDC:**
   - Use a faucet or bridge testnet USDC

3. **Test Payment:**
   - Open: `index.html?user=test123`
   - Connect MetaMask
   - Send payment
   - Verify transaction on https://sepolia.basescan.org/

## How It Works

1. User opens payment page with `?user=USER_ID` parameter
2. Clicks "Connect MetaMask"
3. MetaMask prompts to switch to Base Sepolia (if needed)
4. User clicks "Send 0.1 USDC"
5. MetaMask confirms transaction
6. Page shows success message
7. User returns to Discord/chat
8. Sends transaction hash or "支払いました"
9. Bot verifies payment on blockchain
10. User receives credit

## Security

- ✅ No private keys stored
- ✅ Client-side only (no backend)
- ✅ User controls wallet connection
- ✅ Transaction signed by user's wallet
- ✅ Verified on blockchain

## Troubleshooting

**"Please install MetaMask"**
- Install MetaMask browser extension

**"Please switch to Base Sepolia"**
- Allow MetaMask to switch networks automatically
- Or manually add Base Sepolia network

**"Transaction failed"**
- Check you have enough ETH for gas
- Check you have at least 0.1 USDC
- Try again with higher gas

## License

MIT
