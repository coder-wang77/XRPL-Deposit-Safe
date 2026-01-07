# How to Fix Invalid PAYER_SEED

## Current Error
Your `PAYER_SEED` contains an underscore (`_`), which is not allowed in XRPL seeds.

## Solution: Generate a New Wallet

### Step 1: Get a Valid Testnet Wallet

1. **Open XRPL Testnet Faucet:**
   - Visit: https://xrpl.org/xrp-testnet-faucet.html
   - Or: https://xrpl.org/resources/dev-tools/xrp-faucets/

2. **Generate Credentials:**
   - Click the "Generate credentials" button
   - You'll get:
     - **Address** (starts with 'r')
     - **Secret** (starts with 's') ← This is your PAYER_SEED

3. **Copy the Secret:**
   - It should look like: `sXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
   - No underscores, only letters and numbers
   - Starts with 's'

### Step 2: Update Your .env File

1. **Open your `.env` file** in the `server` directory

2. **Replace the PAYER_SEED line:**
   ```env
   PAYER_SEED=sYourNewSecretFromFaucetHere
   ```

3. **Make sure:**
   - No quotes around the seed
   - No spaces
   - No underscores
   - Starts with 's'

### Step 3: Restart the Server

```bash
# Stop the current server (Ctrl+C or kill the process)
# Then restart:
cd server
npm start
```

### Step 4: Test Again

Visit: http://localhost:3001/api/test/wallet

You should now see:
```json
{
  "ok": true,
  "wallet": {
    "address": "r...",
    "xrpBalance": 10000,
    "xlusdBalance": 0,
    "hasTrustline": false
  },
  "xlusd": {
    "issuer": "...",
    "purchasePrice": 1.0,
    "dexPrice": null,
    "availableOnDEX": false
  }
}
```

## Alternative: Use Existing Wallet

If you already have a valid XRPL seed:
1. Make sure it starts with 's'
2. No underscores or special characters
3. Update `.env` with your valid seed
4. Fund it with test XRP if needed

## Verify It Works

After fixing, the test endpoint should show:
- ✅ Valid wallet address
- ✅ XRP balance (should be > 10 for transactions)
- ✅ Purchase price: $1.00 USD per XLUSD

Then you can test purchasing XLUSD via the web interface!
