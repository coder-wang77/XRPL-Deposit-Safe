# Quick Start Guide

## Starting the Server

### If you get "EADDRINUSE" error:

**Quick fix:**
```bash
# Kill processes on port 3001
lsof -ti:3001 | xargs kill -9

# Then start server
cd server
npm start
```

### Normal Start:

```bash
cd server
npm start
```

You should see:
```
✅ Server starting...
✅ PAYER_SEED loaded: true
✅ SESSION_SECRET loaded: true
🚀 Backend running at http://localhost:3001
📊 Test wallet: http://localhost:3001/api/test/wallet
```

## Testing

1. **Test Wallet:**
   - Browser: http://localhost:3001/api/test/wallet
   - Terminal: `curl http://localhost:3001/api/test/wallet`

2. **Start Frontend:**
   - Open `web/index.html` with Live Server
   - Usually runs on port 5501 or 5503

3. **Test Purchase:**
   - Login to web app
   - Click "Buy XLUSD"
   - Enter amount and complete purchase

## Stopping the Server

**If running in terminal:**
- Press `Ctrl+C`

**If running in background:**
```bash
lsof -ti:3001 | xargs kill
```

## Troubleshooting

**Port in use?**
```bash
lsof -ti:3001 | xargs kill -9
```

**Server not responding?**
```bash
curl http://localhost:3001/health
# Should return: "Server is running"
```

**Check if server is running:**
```bash
lsof -i:3001
```
