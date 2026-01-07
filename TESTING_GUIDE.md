# Complete Testing Guide for Wallet and XLUSD Purchase

## Prerequisites Checklist

Before testing, make sure:
- [ ] Server is running on port 3001
- [ ] Wallet seed is valid (no underscores)
- [ ] Wallet has XRP balance (at least 10 XRP recommended)
- [ ] Frontend is accessible (Live Server on port 5501 or 5503)

---

## Part 1: Verify Server and Wallet Setup

### Step 1.1: Check Server Status

**Terminal Command:**
```bash
curl http://localhost:3001/health
```

**Expected Result:**
```
Server is running
```

**If it fails:**
- Start server: `cd server && npm start`
- Check if port 3001 is in use: `lsof -ti:3001`

### Step 1.2: Test Wallet Endpoint

**Browser:**
Open: `http://localhost:3001/api/test/wallet`

**Terminal:**
```bash
curl http://localhost:3001/api/test/wallet
```

**Expected Result (JSON):**
```json
{
  "ok": true,
  "wallet": {
    "address": "rBwv2gnZWLyG6FuKvbUbx3nhSN8chFE1H7",
    "xrpBalance": 100,
    "xlusdBalance": 0,
    "hasTrustline": false
  },
  "xlusd": {
    "issuer": "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq",
    "purchasePrice": 1.0,
    "dexPrice": null,
    "availableOnDEX": false
  }
}
```

**What to Check:**
- ✅ `ok: true` - Wallet is working
- ✅ `xrpBalance` > 10 - Sufficient for transactions
- ✅ `purchasePrice: 1.0` - $1 USD per XLUSD

---

## Part 2: Test via Web Interface

### Step 2.1: Start Frontend

1. **Open your project in VS Code**
2. **Right-click on `web/index.html`**
3. **Select "Open with Live Server"**
   - Should open on `http://localhost:5501` or `http://localhost:5503`
   - Check the port in VS Code status bar

### Step 2.2: Create/Login Account

1. **Open the login page:**
   - URL: `http://localhost:5501/index.html` (or port 5503)

2. **Create a new account:**
   - Enter email: `test@example.com`
   - Enter password: `test123` (min 6 characters)
   - Click "Create Account"
   - You should see: "✅ Account created: test@example.com"
   - Automatically redirected to dashboard

3. **Or login if account exists:**
   - Enter your email and password
   - Click "Sign In"

### Step 2.3: Check Dashboard

**What you should see:**
- Top right: XLUSD Balance (initially "0.00 XLUSD")
- Statistics cards showing:
  - Total Escrows: 0
  - Total Value: 0 XRP
  - Completed: 0
  - Pending: 0
- Recent Activity section (empty initially)

**Verify:**
- Balance shows "Loading..." then updates to "0.00 XLUSD"
- No errors in browser console (F12)

### Step 2.4: Test Purchase XLUSD

1. **Navigate to Buy XLUSD:**
   - Click "Buy XLUSD" button in top right
   - Or click "Buy XLUSD" in sidebar
   - URL: `http://localhost:5501/buy-xlusd.html`

2. **Fill in Purchase Form:**
   - **Amount:** Enter `10` (or any amount)
   - **Total:** Should show "$10.00 USD"
   - **Payment Method:** Choose "Credit Card" or "PayNow"

3. **If Credit Card:**
   - Card Number: `4242 4242 4242 4242` (Stripe test card)
   - Expiry: `12/25`
   - CVV: `123`
   - Cardholder Name: `Test User`
   - Billing Email: `test@example.com`

4. **If PayNow:**
   - Mobile Number: `+65 9123 4567`
   - Name: `Test User`
   - Reference number will be generated

5. **Click "Process Payment"**

6. **Expected Result:**
   - Success message: "✅ Payment successful!"
   - Shows: "You received 10 XLUSD"
   - Transaction ID displayed
   - Redirects to dashboard after 3 seconds

### Step 2.5: Verify Purchase

1. **Check Dashboard Balance:**
   - Top right should now show: "10.00 XLUSD" (or your purchase amount)
   - Balance updates automatically

2. **Check Recent Activity:**
   - Should show: "💰 XLUSD Purchased"
   - Status: "completed"
   - Timestamp displayed

3. **Verify via API:**
   - Open browser console (F12)
   - Run:
   ```javascript
   fetch('http://localhost:3001/api/xlusd/balance', {
     credentials: 'include'
   }).then(r => r.json()).then(console.log)
   ```
   - Should show: `{ok: true, balance: 10, ...}`

---

## Part 3: Test Withdrawal

### Step 3.1: Navigate to Withdraw

1. **Click "Withdraw" in sidebar**
   - Or go to: `http://localhost:5501/withdraw.html`

2. **Check Available Balance:**
   - Should show your XLUSD balance (e.g., "10.00 XLUSD")

### Step 3.2: Test Withdrawal

1. **Enter Amount:**
   - Amount: `5` (less than your balance)
   - Total: Should show "$5.00 USD"

2. **Choose Withdrawal Method:**
   - **Bank Transfer:**
     - Bank Name: `DBS`
     - Account Number: `1234567890`
     - Account Holder: `Test User`
     - SWIFT Code: `DBSSSGSG` (optional)
   
   - **PayNow:**
     - Mobile Number: `+65 9123 4567`
     - Name: `Test User`

3. **Click "Process Withdrawal"**

4. **Expected Result:**
   - Success message: "✅ Withdrawal initiated!"
   - Shows transaction hash
   - Status: "processing"
   - Balance decreases by withdrawal amount

### Step 3.3: Check Withdrawal History

- Right panel shows "Recent Withdrawals"
- Should list your withdrawal with status "processing"

---

## Part 4: Test via API (Advanced)

### Step 4.1: Get Session Cookie

**Terminal:**
```bash
curl -X POST http://localhost:3001/api/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"email":"test@example.com","password":"test123"}'
```

**Expected:**
```json
{"ok":true,"user":{"email":"test@example.com"}}
```

### Step 4.2: Check Balance

```bash
curl http://localhost:3001/api/xlusd/balance \
  -b cookies.txt \
  -H "Content-Type: application/json"
```

**Expected:**
```json
{
  "ok": true,
  "balance": 10,
  "currency": "XLUSD",
  "issuer": "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq",
  "account": "rBwv2gnZWLyG6FuKvbUbx3nhSN8chFE1H7"
}
```

### Step 4.3: Test Purchase

```bash
curl -X POST http://localhost:3001/api/xlusd/purchase \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "amountXlusd": 5,
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

**Expected:**
```json
{
  "ok": true,
  "txHash": "ABC123...",
  "txResult": "tesSUCCESS",
  "amountXlusd": 5,
  "paymentId": "cc_...",
  "paymentMethod": "creditcard"
}
```

### Step 4.4: Test Withdrawal

```bash
curl -X POST http://localhost:3001/api/xlusd/withdraw \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{
    "amountXlusd": 3,
    "withdrawalMethod": "paynow",
    "accountDetails": {
      "mobile": "+65 9123 4567",
      "name": "Test User"
    }
  }'
```

**Expected:**
```json
{
  "ok": true,
  "txHash": "XYZ789...",
  "txResult": "tesSUCCESS",
  "amountXlusd": 3,
  "amountUsd": 3,
  "withdrawalId": "wd_...",
  "withdrawalMethod": "paynow",
  "status": "processing"
}
```

---

## Part 5: Verify XRPL Transactions

### Step 5.1: Check Transaction on XRPL Explorer

1. **Get transaction hash from purchase/withdrawal response**
2. **Visit:** https://testnet.xrpl.org
3. **Search for transaction hash**
4. **Verify:**
   - Transaction status: "Success"
   - Amount transferred
   - Accounts involved

### Step 5.2: Check Wallet on XRPL Explorer

1. **Visit:** https://testnet.xrpl.org
2. **Search for your wallet address:** `rBwv2gnZWLyG6FuKvbUbx3nhSN8chFE1H7`
3. **Check:**
   - XRP balance
   - Trustlines (should show XLUSD trustline after first purchase)
   - Transaction history

---

## Part 6: Troubleshooting

### Issue: "Cannot reach backend"

**Check:**
1. Server running? `curl http://localhost:3001/health`
2. CORS configured? Check `server/index.js` line 37
3. Frontend port matches CORS? (5501 or 5503)

**Fix:**
- Restart server: `cd server && npm start`
- Check browser console (F12) for errors

### Issue: "Not logged in"

**Check:**
1. Session expired? Try logging in again
2. Cookies enabled? Check browser settings
3. Same origin? Frontend and backend must use same protocol

**Fix:**
- Clear cookies and login again
- Check `credentials: 'include'` in fetch requests

### Issue: "Payment failed"

**Check:**
1. Server logs for errors
2. Wallet has sufficient XRP? (need ~10 XRP for transactions)
3. Trustline creation succeeded?

**Fix:**
- Check server terminal for error messages
- Verify wallet balance: `http://localhost:3001/api/test/wallet`
- Fund wallet if needed: https://xrpl.org/xrp-testnet-faucet.html

### Issue: Balance not updating

**Check:**
1. Transaction succeeded? Check transaction hash
2. Trustline created? Check XRPL Explorer
3. Browser cache? Hard refresh (Ctrl+Shift+R)

**Fix:**
- Wait a few seconds (XRPL transactions take time)
- Refresh dashboard
- Check balance via API directly

---

## Part 7: Test Checklist

Use this checklist to verify everything works:

### Setup
- [ ] Server running on port 3001
- [ ] Wallet test endpoint returns valid JSON
- [ ] Wallet has > 10 XRP balance
- [ ] Frontend accessible on port 5501 or 5503

### Authentication
- [ ] Can create account
- [ ] Can login
- [ ] Session persists
- [ ] Can logout

### Dashboard
- [ ] Dashboard loads
- [ ] XLUSD balance displays
- [ ] Statistics cards show (may be 0 initially)
- [ ] Recent activity section visible

### Purchase
- [ ] Can navigate to Buy XLUSD page
- [ ] Amount input works
- [ ] Price calculation correct ($1 per XLUSD)
- [ ] Can select payment method
- [ ] Can fill payment form
- [ ] Payment processes successfully
- [ ] Balance updates after purchase
- [ ] Transaction appears in history

### Withdrawal
- [ ] Can navigate to Withdraw page
- [ ] Available balance displays
- [ ] Can enter withdrawal amount
- [ ] Can select withdrawal method
- [ ] Can fill withdrawal form
- [ ] Withdrawal processes successfully
- [ ] Balance decreases after withdrawal
- [ ] Withdrawal appears in history

### XRPL Verification
- [ ] Transactions visible on XRPL Explorer
- [ ] Trustline created after first purchase
- [ ] XLUSD balance matches on XRPL

---

## Quick Test Commands

**Test wallet:**
```bash
curl http://localhost:3001/api/test/wallet
```

**Test server:**
```bash
curl http://localhost:3001/health
```

**Test balance (requires login):**
```bash
# First login, then:
curl http://localhost:3001/api/xlusd/balance -b cookies.txt
```

---

## Expected Test Results

After completing all tests, you should have:
- ✅ Account created and logged in
- ✅ Purchased XLUSD successfully
- ✅ Balance updated correctly
- ✅ Withdrawn XLUSD successfully
- ✅ Transactions visible on XRPL Explorer
- ✅ Trustline created automatically
- ✅ All features working end-to-end

---

## Next Steps After Testing

1. **Production Setup:**
   - Add Stripe keys for real payments
   - Configure PayNow integration
   - Set up webhook endpoints

2. **Security:**
   - Change default SESSION_SECRET
   - Use environment variables for all secrets
   - Enable HTTPS in production

3. **Monitoring:**
   - Set up error logging
   - Monitor transaction success rates
   - Track user activity
