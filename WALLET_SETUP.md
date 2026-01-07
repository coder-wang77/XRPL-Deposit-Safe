# Wallet Setup & Testing Guide

## Issue Found
Your `PAYER_SEED` contains an underscore, which is invalid for XRPL seeds.

## How to Fix

### Option 1: Generate a New Wallet (Recommended for Testnet)

1. **Visit XRPL Testnet Faucet:**
   - Go to: https://xrpl.org/xrp-testnet-faucet.html
   - Click "Generate credentials"
   - Copy the **Secret** (starts with 's')

2. **Update your `.env` file:**
   ```env
   PAYER_SEED=sYourNewSecretSeedHere...
   ```

3. **Fund the wallet:**
   - The faucet will automatically fund your wallet with test XRP
   - Or use the "Fund Test Account" button on the faucet page

### Option 2: Use Existing Wallet

If you have a valid XRPL seed (starts with 's', no underscores):
1. Update `.env` with your valid seed
2. Fund it with test XRP from the faucet

## Testing Your Wallet

### 1. Run the Test Script
```bash
cd server
node test_wallet_simple.js
```

This will check:
- ✅ Seed format validity
- ✅ Wallet address
- ✅ XRP balance
- ✅ XLUSD trustline
- ✅ DEX availability

### 2. Test via Web Interface

1. **Start the server:**
   ```bash
   cd server
   npm start
   ```

2. **Open the web app:**
   - Navigate to the login page
   - Log in or create an account

3. **Check balance:**
   - Go to Dashboard
   - Check the XLUSD balance in the top right

4. **Test purchase:**
   - Click "Buy XLUSD"
   - Enter an amount (e.g., 10 XLUSD)
   - Choose payment method (Credit Card or PayNow)
   - For testing, use simulated payment (no Stripe key needed)

### 3. Test Purchase Endpoint Directly

If you want to test the API directly:

```bash
# First, get a session (login)
curl -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"your@email.com","password":"yourpassword"}'

# Then test purchase (with session cookie)
curl -X POST http://localhost:3001/api/xlusd/purchase \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "amountXlusd": 10,
    "paymentMethod": "creditcard",
    "cardDetails": {
      "number": "4242424242424242",
      "expiry": "12/25",
      "cvv": "123",
      "name": "Test User",
      "email": "test@example.com"
    }
  }'
```

## Current Price Check

The purchase endpoint uses a fixed rate of **$1.00 USD per XLUSD**.

To check DEX prices (if XLUSD is traded on DEX):
- The test script will show current DEX prices
- Or check via XRPL Explorer: https://testnet.xrpl.org

## Troubleshooting

### "Invalid seed format"
- Make sure seed starts with 's'
- No underscores or special characters
- Should be 29 characters long

### "Low balance"
- Get test XRP from: https://xrpl.org/xrp-testnet-faucet.html
- Minimum 10 XRP recommended for transactions

### "Cannot reach backend"
- Make sure server is running: `cd server && npm start`
- Check port 3001 is not in use
- Verify CORS settings match your frontend port

### "No XLUSD trustline"
- This is OK - trustline will be created automatically on first purchase
- Or create manually using XRPL client

## Next Steps

1. ✅ Fix your seed in `.env`
2. ✅ Run test script to verify wallet
3. ✅ Fund wallet with test XRP
4. ✅ Test purchase via web interface
5. ✅ Verify XLUSD balance updates
