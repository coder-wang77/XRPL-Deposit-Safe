#!/bin/bash
echo "🚀 Quick Start - XLUSD & Escrow Testing"
echo ""
echo "Step 1: Configure .env file"
echo "Edit server/.env and add your testnet wallet seeds:"
echo "  PAYER_SEED=sYourWalletSeedHere"
echo "  PAYEE_SEED=sYourPayeeSeedHere (optional)"
echo ""
echo "Get testnet wallets from: https://xrpl.org/xrp-testnet-faucet.html"
echo ""
read -p "Press Enter once you've configured .env file..."

echo ""
echo "Step 2: Starting server..."
cd server
npm start
