# Troubleshooting: Can't Open Test Wallet Endpoint

## Issue: Can't Access http://localhost:3001/api/test/wallet

### Solution 1: Restart the Server

The server might be running an old version. Restart it:

```bash
# Find and kill the server process
lsof -ti:3001 | xargs kill

# Start fresh
cd server
npm start
```

Wait for: `🚀 Backend running at http://localhost:3001`

### Solution 2: Check Browser Issues

**Try these in order:**

1. **Hard Refresh:**
   - Chrome/Edge: `Ctrl+Shift+R` (Windows) or `Cmd+Shift+R` (Mac)
   - Firefox: `Ctrl+F5` or `Cmd+Shift+R`

2. **Clear Browser Cache:**
   - Open DevTools (F12)
   - Right-click refresh button
   - Select "Empty Cache and Hard Reload"

3. **Try Different Browser:**
   - Test in Chrome, Firefox, or Safari
   - Sometimes browser extensions block requests

4. **Check Browser Console:**
   - Press F12
   - Go to Console tab
   - Look for errors (red text)
   - Common: CORS errors, network errors

### Solution 3: Test via Terminal First

Before trying browser, test via terminal:

```bash
curl http://localhost:3001/api/test/wallet
```

**If this works but browser doesn't:**
- It's a browser/CORS issue
- Check CORS settings in `server/index.js`

**If this doesn't work:**
- Server issue
- Check server logs
- Restart server

### Solution 4: Check Server Logs

```bash
# If server is running in background, check logs
tail -f /tmp/server.log

# Or if running in terminal, check the output
```

Look for:
- ✅ "Server starting..."
- ✅ "Backend running at http://localhost:3001"
- ❌ Any error messages

### Solution 5: Verify Endpoint Exists

Check if endpoint is in code:

```bash
grep -n "api/test/wallet" server/index.js
```

Should show: `942:app.get("/api/test/wallet"`

### Solution 6: Test Other Endpoints

Test if server is working at all:

```bash
# Health check (should work)
curl http://localhost:3001/health

# Should return: "Server is running"
```

### Solution 7: Check Port Conflicts

```bash
# Check what's using port 3001
lsof -i:3001

# Should show your node process
# If shows something else, kill it:
lsof -ti:3001 | xargs kill
```

### Solution 8: Try Different URL Format

Sometimes browsers cache URLs. Try:

- `http://127.0.0.1:3001/api/test/wallet`
- `http://localhost:3001/api/test/wallet`

### Solution 9: Check Firewall/Antivirus

- Some antivirus blocks localhost connections
- Temporarily disable to test
- Add exception for localhost:3001

### Solution 10: Use JSON Formatter Extension

Install a browser extension to format JSON:
- Chrome: "JSON Formatter"
- Firefox: "JSONView"

This helps see the response even if it's not formatted.

## Quick Diagnostic Commands

Run these to diagnose:

```bash
# 1. Check server running
curl http://localhost:3001/health

# 2. Test endpoint
curl http://localhost:3001/api/test/wallet

# 3. Check port
lsof -i:3001

# 4. Check server process
ps aux | grep "node.*index.js" | grep -v grep
```

## Expected Results

**Terminal (curl):**
```json
{
  "ok": true,
  "wallet": {
    "address": "rBwv2gnZWLyG6FuKvbUbx3nhSN8chFE1H7",
    "xrpBalance": 79.999928,
    "xlusdBalance": 0,
    "hasTrustline": false
  },
  "xlusd": {
    "issuer": "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq",
    "purchasePrice": 1,
    "dexPrice": null,
    "availableOnDEX": false
  }
}
```

**Browser:**
- Should show formatted JSON (if extension installed)
- Or raw JSON text
- No errors in console

## Still Not Working?

1. **Check server terminal output** for errors
2. **Check browser console** (F12) for errors
3. **Try incognito/private mode** to rule out extensions
4. **Restart everything:**
   - Kill server
   - Close browser
   - Restart server
   - Open browser fresh
