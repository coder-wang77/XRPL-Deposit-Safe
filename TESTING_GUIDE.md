# Testing Guide - XLUSD & Escrow Functions

## Quick Setup

### 1. Get Testnet Wallets
Visit: https://xrpl.org/xrp-testnet-faucet.html
- Generate at least 2 wallets (one for PAYER, one for PAYEE)
- Fund them with test XRP

### 2. Configure .env file
Edit `server/.env` and add your seeds:
```bash
PAYER_SEED=sYourPayerWalletSeedHere
PAYEE_SEED=sYourPayeeWalletSeedHere
SESSION_SECRET=dev_secret_$(date +%s)
NODE_ENV=development
```

### 3. Start the Server
```bash
cd server
npm start
```

### 4. Open the Frontend
Open `web/dashboard.html` in your browser (using Live Server or file://)

## Testing XLUSD Purchase

1. **Login/Signup**: Create an account on the dashboard
2. **Buy XLUSD**: 
   - Click "Buy XLUSD" button
   - Enter amount
   - Choose payment method (simulated if no Stripe key)

## Testing Escrow Functions

### Test Freelancer Payment Workflow:
1. **Lock Payment**:
   - Enter freelancer address (use PAYEE address for testing)
   - Enter amount (e.g., 10 XRP)
   - Set deadline
   - Click "Lock Payment"
   - **Save the preimage** shown!

2. **Release Payment**:
   - After work is "done", click "Release (Share Preimage)"
   - Copy the preimage
   - Switch to freelancer account or use PAYEE wallet
   - Go to "Flow B - Release Deposit"
   - Enter owner address, sequence, and paste preimage
   - Click "Claim Deposit"

3. **Refund (if not satisfied)**:
   - After deadline passes
   - Click "Refund After Deadline"
   - Funds return to payer

### Test General Escrow:
1. **Create Escrow**: Use "Flow A" card
2. **Finish Escrow**: Use "Flow B" card  
3. **Cancel Escrow**: Use "Flow C" card

## Debug Endpoints

- Health: http://localhost:3001/health
- Payer Address: http://localhost:3001/debug/payer
- Payee Address: http://localhost:3001/debug/payee

## Troubleshooting

- **Server won't start**: Check .env file has PAYER_SEED
- **CORS errors**: Make sure frontend is served from allowed origin
- **Transaction fails**: Check wallet has enough XRP (testnet)
