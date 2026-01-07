# Payment & Withdrawal Setup Guide

## Overview

This application supports:
- **Buying XLUSD** via Credit Card (Stripe) or PayNow
- **Withdrawing XLUSD** to Bank Transfer or PayNow

## Setup Instructions

### 1. Stripe Integration (Credit Card Payments)

#### Install Stripe Package (Optional)
```bash
cd server
npm install stripe
```

#### Configure Stripe Keys
Add to your `.env` file:
```env
STRIPE_SECRET_KEY=sk_test_...  # Your Stripe secret key
STRIPE_PUBLISHABLE_KEY=pk_test_...  # Your Stripe publishable key (for frontend)
```

#### Get Stripe Keys
1. Sign up at https://stripe.com
2. Go to Developers > API keys
3. Copy your test keys (use live keys in production)

#### Frontend Integration
For full Stripe integration, you'll need to:
1. Add Stripe.js to your frontend
2. Use the `clientSecret` returned from the payment endpoint
3. Confirm payment on the frontend before XLUSD is minted

### 2. PayNow Integration

#### Option A: Direct PayNow API
- Sign up with a payment gateway that supports PayNow (e.g., Stripe Singapore, Razorpay)
- Configure webhook endpoints to verify payments
- Update the payment verification logic in `/api/xlusd/purchase`

#### Option B: Manual Verification
- For development, payments are simulated
- In production, implement payment verification via webhook

### 3. Withdrawal Setup

#### Bank Transfer
The withdrawal endpoint currently:
1. Burns/returns XLUSD to issuer
2. Records withdrawal in database
3. Returns withdrawal ID

**To complete the flow:**
- Integrate with a payment gateway that supports payouts (Stripe Connect, Razorpay, etc.)
- Set up webhook to process withdrawals when XLUSD is returned
- Implement actual bank transfer or PayNow payout

#### PayNow Payout
- Use payment gateway API to send PayNow payments
- Verify recipient mobile number
- Process payout after XLUSD is returned

## Database Schema

The following tables are created automatically:
- `payments` - Records all purchases
- `withdrawals` - Records all withdrawal requests

## Testing

### Test Mode
Without Stripe keys configured, the system uses simulated payments for development.

### Production Mode
1. Set `STRIPE_SECRET_KEY` in `.env`
2. Configure webhook endpoints
3. Test with Stripe test cards
4. Switch to live keys when ready

## Security Notes

1. **Never commit API keys** to version control
2. **Use environment variables** for all secrets
3. **Verify payments** before minting XLUSD
4. **Implement rate limiting** on payment endpoints
5. **Log all transactions** for audit purposes

## Next Steps

1. Set up Stripe account and get API keys
2. Configure webhook endpoints for payment verification
3. Implement payout integration for withdrawals
4. Add email notifications for payment/withdrawal status
5. Set up monitoring and alerts
