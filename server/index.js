import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import xrpl from "xrpl";
import session from "express-session";
import bcrypt from "bcrypt";

import db from "./db.js";
import {
  getClient,
  createEscrow,
  finishEscrow,
  cancelEscrow,
} from "./xrpl.js";

dotenv.config();

const app = express();

/* ======================
   LOGS
====================== */
console.log("✅ Server starting...");
console.log("✅ PAYER_SEED loaded:", !!process.env.PAYER_SEED);
console.log("✅ SESSION_SECRET loaded:", !!process.env.SESSION_SECRET);

/* ======================
   MIDDLEWARE (ORDER MATTERS)
====================== */

// parse JSON
app.use(express.json());

// CORS for Live Server
app.use(
  cors({
    origin: ["http://127.0.0.1:5501", "http://127.0.0.1:5503", "http://localhost:5501", "http://localhost:5503"],
    credentials: true,
  })
);

// Sessions
app.use(
  session({
    name: "depositsafe.sid",
    secret: process.env.SESSION_SECRET || "DEV_ONLY_CHANGE_ME",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false, // set true only if HTTPS
      maxAge: 1000 * 60 * 60 * 2, // default 2 hours
    },
  })
);

/* ======================
   HELPERS
====================== */

function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  next();
}

/* ======================
   HEALTH
====================== */

app.get("/health", (req, res) => {
  res.send("Server is running");
});

/* ======================
   AUTH
====================== */

// SIGNUP
app.post("/api/signup", async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const cleanEmail = email.toLowerCase().trim();
    const hash = await bcrypt.hash(password, 12);

    db.run(
      "INSERT INTO users (email, password_hash) VALUES (?, ?)",
      [cleanEmail, hash],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE")) {
            return res.status(409).json({ error: "Email already exists" });
          }
          console.error("DB INSERT ERROR:", err);
          return res.status(500).json({ error: "Database error" });
        }

        // session
        req.session.user = { id: this.lastID, email: cleanEmail };

        // remember me: 7 days
        if (rememberMe) {
          req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 7;
        }

        return res.json({ ok: true, user: { email: cleanEmail } });
      }
    );
  } catch (e) {
    console.error("SIGNUP ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password, rememberMe } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  const cleanEmail = email.toLowerCase().trim();

  db.get("SELECT * FROM users WHERE email = ?", [cleanEmail], async (err, user) => {
    if (err) {
      console.error("DB GET ERROR:", err);
      return res.status(500).json({ error: "Database error" });
    }

    if (!user) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    req.session.user = { id: user.id, email: user.email };

    // remember me: 7 days
    if (rememberMe) {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 24 * 7;
    } else {
      req.session.cookie.maxAge = 1000 * 60 * 60 * 2; // 2 hours
    }

    return res.json({ ok: true, user: { email: user.email } });
  });
});

// WHO AM I
app.get("/api/me", (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  return res.json({ ok: true, user: req.session.user });
});

// LOGOUT
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("depositsafe.sid");
    res.json({ ok: true });
  });
});

/* ======================
   ESCROW ROUTES (XRPL) - PROTECTED
====================== */

// CREATE ESCROW
app.post("/escrow/create", requireAuth, async (req, res) => {
  let client;
  try {
    const { payeeAddress, amountXrp, finishAfterUnix, cancelAfterUnix } =
      req.body || {};

    const finish = Number(finishAfterUnix);
    const cancel = cancelAfterUnix ? Number(cancelAfterUnix) : null;

    if (!payeeAddress || !amountXrp || !Number.isFinite(finish)) {
      return res.status(400).json({ error: "Invalid input" });
    }

    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "Missing PAYER_SEED" });
    }

    const payerWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    client = await getClient();

    const { result, offerSequence } = await createEscrow({
      client,
      payerWallet,
      payeeAddress,
      amountXrp,
      finishAfterUnix: finish,
      cancelAfterUnix: cancel,
    });

    const txResult = result.result?.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      return res.status(400).json({
        ok: false,
        txResult,
        engine_result: result.result?.engine_result,
        engine_result_message: result.result?.engine_result_message,
        txHash: result.result?.hash,
      });
    }

    return res.json({
      ok: true,
      txHash: result.result?.hash,
      offerSequence,
      txResult,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

// FINISH ESCROW
app.post("/escrow/finish", requireAuth, async (req, res) => {
  let client;
  try {
    const { ownerAddress, offerSequence } = req.body || {};
    if (!ownerAddress || offerSequence === undefined) {
      return res.status(400).json({ error: "Missing ownerAddress / offerSequence" });
    }

    const seed = process.env.PAYEE_SEED || process.env.PAYER_SEED;
    if (!seed) return res.status(500).json({ error: "Missing PAYEE_SEED or PAYER_SEED" });

    const payeeWallet = xrpl.Wallet.fromSeed(seed);
    client = await getClient();

    const out = await finishEscrow({
      client,
      payeeWallet,
      ownerAddress,
      offerSequence,
    });

    return res.json({
      ok: out.txResult === "tesSUCCESS",
      txHash: out.hash,
      txResult: out.txResult,
      validated: out.validated,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

// CANCEL ESCROW
app.post("/escrow/cancel", requireAuth, async (req, res) => {
  let client;
  try {
    const { ownerAddress, offerSequence } = req.body || {};
    if (!ownerAddress || offerSequence === undefined) {
      return res.status(400).json({ error: "Missing ownerAddress / offerSequence" });
    }

    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "Missing PAYER_SEED" });
    }

    const payerWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    client = await getClient();

    const out = await cancelEscrow({
      client,
      payerWallet,
      ownerAddress,
      offerSequence,
    });

    return res.json({
      ok: out.txResult === "tesSUCCESS",
      txHash: out.hash,
      txResult: out.txResult,
      validated: out.validated,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

/* ======================
   DEBUG (OPTIONAL)
====================== */

app.get("/debug/payer", (req, res) => {
  if (!process.env.PAYER_SEED)
    return res.status(500).json({ error: "Missing PAYER_SEED" });

  const w = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
  res.json({ payerAddress: w.classicAddress });
});

app.get("/debug/payee", (req, res) => {
  if (!process.env.PAYEE_SEED)
    return res.status(500).json({ error: "Missing PAYEE_SEED" });

  const w = xrpl.Wallet.fromSeed(process.env.PAYEE_SEED);
  res.json({ payeeAddress: w.classicAddress });
});

/* ======================
   XLUSD BALANCE & BUY
====================== */

// GET XLUSD BALANCE
app.get("/api/xlusd/balance", requireAuth, async (req, res) => {
  let client;
  try {
    // Use PAYER_SEED account by default, or allow account address in query
    const accountAddress = req.query.address;
    
    let address;
    if (!accountAddress) {
      if (!process.env.PAYER_SEED) {
        return res.status(500).json({ error: "Missing PAYER_SEED or account address" });
      }
      const wallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
      address = wallet.classicAddress;
    } else {
      address = accountAddress;
    }
    
    client = await getClient();
    
    // Get account lines (trustlines) to find XLUSD balance
    const accountLines = await client.request({
      command: "account_lines",
      account: address,
      ledger_index: "validated",
    });

    // XLUSD issuer - common testnet issuer, can be overridden via env
    const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq"; // Default testnet issuer
    const xlusdCurrency = "XLUSD";

    // Find XLUSD trustline
    const xlusdLine = accountLines.result.lines?.find(
      (line) =>
        line.currency === xlusdCurrency &&
        line.account === xlusdIssuer
    );

    const balance = xlusdLine ? parseFloat(xlusdLine.balance) : 0;

    return res.json({
      ok: true,
      balance,
      currency: xlusdCurrency,
      issuer: xlusdIssuer,
      account: address,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

// PURCHASE XLUSD (Process payment via credit card or PayNow)
app.post("/api/xlusd/purchase", requireAuth, async (req, res) => {
  let client;
  try {
    const { amountXlusd, paymentMethod, cardDetails, paynowRef } = req.body || {};
    const userId = req.session.user?.id;

    if (!amountXlusd || !Number.isFinite(Number(amountXlusd)) || Number(amountXlusd) <= 0) {
      return res.status(400).json({ error: "Invalid amountXlusd" });
    }

    if (!paymentMethod || !["creditcard", "paynow"].includes(paymentMethod)) {
      return res.status(400).json({ error: "Invalid payment method" });
    }

    // Get user's account address (for now, use PAYER_SEED, but ideally get from session)
    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "Missing PAYER_SEED" });
    }

    const recipientWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    const recipientAddress = recipientWallet.classicAddress;

    const amountUsd = Number(amountXlusd) * 1.0; // $1 per XLUSD
    let paymentId;
    let paymentStatus = "pending";

    // Record payment in database
    db.run(
      `INSERT INTO payments (user_id, amount_xlusd, amount_usd, payment_method, status) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, amountXlusd, amountUsd, paymentMethod, "pending"],
      function (err) {
        if (err) {
          console.error("Failed to record payment:", err);
        }
      }
    );

    if (paymentMethod === "creditcard") {
      if (!cardDetails) {
        return res.status(400).json({ error: "Card details required" });
      }

      // Stripe integration (if STRIPE_SECRET_KEY is set)
      if (process.env.STRIPE_SECRET_KEY) {
        try {
          // Dynamic import for Stripe (ES module compatible)
          const stripeModule = await import("stripe");
          const Stripe = stripeModule.default;
          const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
          
          // Create payment intent
          const paymentIntent = await stripe.paymentIntents.create({
            amount: Math.round(amountUsd * 100), // Convert to cents
            currency: "usd",
            metadata: {
              userId: userId,
              amountXlusd: amountXlusd,
            },
            automatic_payment_methods: {
              enabled: true,
            },
          });

          // For now, we'll use the payment intent ID
          // In production, you'd confirm the payment on the frontend first using Stripe.js
          paymentId = paymentIntent.id;
          paymentStatus = paymentIntent.status === "succeeded" ? "completed" : "pending";
          
          // If payment requires confirmation, return client_secret for frontend
          if (paymentIntent.status === "requires_payment_method") {
            return res.json({
              ok: false,
              requiresConfirmation: true,
              clientSecret: paymentIntent.client_secret,
              paymentIntentId: paymentIntent.id,
            });
          }
        } catch (stripeErr) {
          console.error("Stripe error:", stripeErr);
          // Fall back to simulated payment for development
          paymentId = `cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          paymentStatus = "completed";
        }
      } else {
        // Simulated payment for development
        console.log("⚠️  Stripe not configured. Using simulated payment.");
        paymentId = `cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        paymentStatus = "completed";
      }
      
    } else if (paymentMethod === "paynow") {
      if (!paynowRef) {
        return res.status(400).json({ error: "PayNow reference required" });
      }
      
      // PayNow integration would go here
      // For now, simulate payment
      paymentId = `pn_${paynowRef}`;
      paymentStatus = "completed";
      
      // TODO: Verify PayNow payment via API
      // In production, you'd verify the payment with PayNow gateway
    }

    if (paymentStatus !== "completed") {
      // Update payment status to failed
      db.run(
        `UPDATE payments SET status = 'failed' WHERE payment_id = ?`,
        [paymentId]
      );
      return res.status(400).json({ error: "Payment processing failed" });
    }

    // After payment is confirmed, mint/transfer XLUSD to user's account
    client = await getClient();
    
    const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
    const xlusdCurrency = "XLUSD";
    const issuerWallet = xrpl.Wallet.fromSeed(process.env.XLUSD_ISSUER_SEED || process.env.PAYER_SEED);

    // Check if recipient has trustline, if not, create it first
    const accountLines = await client.request({
      command: "account_lines",
      account: recipientAddress,
      ledger_index: "validated",
    });

    const hasTrustline = accountLines.result.lines?.some(
      (line) => line.currency === xlusdCurrency && line.account === xlusdIssuer
    );

    if (!hasTrustline) {
      // Create trustline
      const trustlineTx = {
        TransactionType: "TrustSet",
        Account: recipientAddress,
        LimitAmount: {
          currency: xlusdCurrency,
          issuer: xlusdIssuer,
          value: "1000000", // Set a high limit
        },
      };

      const preparedTrustline = await client.autofill(trustlineTx);
      const signedTrustline = recipientWallet.sign(preparedTrustline);
      await client.submitAndWait(signedTrustline.tx_blob);
    }

    // Send XLUSD payment from issuer to recipient
    const paymentTx = {
      TransactionType: "Payment",
      Account: issuerWallet.classicAddress,
      Destination: recipientAddress,
      Amount: {
        currency: xlusdCurrency,
        issuer: xlusdIssuer,
        value: String(amountXlusd),
      },
    };

    const prepared = await client.autofill(paymentTx);
    const signed = issuerWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const txResult = result.result?.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      return res.status(400).json({
        ok: false,
        error: "Failed to transfer XLUSD",
        txResult,
        engine_result: result.result?.engine_result,
        engine_result_message: result.result?.engine_result_message,
        txHash: result.result?.hash,
      });
    }

    // Update payment record with success
    db.run(
      `UPDATE payments SET status = 'completed', payment_id = ?, tx_hash = ? 
       WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      [paymentId, result.result?.hash, userId]
    );

    return res.json({
      ok: true,
      txHash: result.result?.hash,
      txResult,
      amountXlusd: Number(amountXlusd),
      paymentId,
      paymentMethod,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

// WITHDRAW XLUSD (Convert XLUSD back to fiat)
app.post("/api/xlusd/withdraw", requireAuth, async (req, res) => {
  let client;
  try {
    const { amountXlusd, withdrawalMethod, accountDetails } = req.body || {};
    const userId = req.session.user?.id;

    if (!amountXlusd || !Number.isFinite(Number(amountXlusd)) || Number(amountXlusd) <= 0) {
      return res.status(400).json({ error: "Invalid amountXlusd" });
    }

    if (!withdrawalMethod || !["bank", "paynow"].includes(withdrawalMethod)) {
      return res.status(400).json({ error: "Invalid withdrawal method" });
    }

    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "Missing PAYER_SEED" });
    }

    const userWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    const userAddress = userWallet.classicAddress;
    client = await getClient();

    // Check user's XLUSD balance
    const accountLines = await client.request({
      command: "account_lines",
      account: userAddress,
      ledger_index: "validated",
    });

    const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
    const xlusdCurrency = "XLUSD";

    const xlusdLine = accountLines.result.lines?.find(
      (line) => line.currency === xlusdCurrency && line.account === xlusdIssuer
    );

    const currentBalance = xlusdLine ? parseFloat(xlusdLine.balance) : 0;

    if (currentBalance < Number(amountXlusd)) {
      return res.status(400).json({ 
        error: `Insufficient balance. You have ${currentBalance.toFixed(2)} XLUSD` 
      });
    }

    const amountUsd = Number(amountXlusd) * 1.0; // $1 per XLUSD

    // Record withdrawal in database
    db.run(
      `INSERT INTO withdrawals (user_id, amount_xlusd, amount_usd, withdrawal_method, account_details, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, amountXlusd, amountUsd, withdrawalMethod, JSON.stringify(accountDetails || {}), "pending"],
      function (err) {
        if (err) {
          console.error("Failed to record withdrawal:", err);
        }
      }
    );

    // Transfer XLUSD back to issuer (burn/return)
    const issuerWallet = xrpl.Wallet.fromSeed(process.env.XLUSD_ISSUER_SEED || process.env.PAYER_SEED);
    
    const paymentTx = {
      TransactionType: "Payment",
      Account: userAddress,
      Destination: issuerWallet.classicAddress,
      Amount: {
        currency: xlusdCurrency,
        issuer: xlusdIssuer,
        value: String(amountXlusd),
      },
    };

    const prepared = await client.autofill(paymentTx);
    const signed = userWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const txResult = result.result?.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      // Update withdrawal status to failed
      db.run(
        `UPDATE withdrawals SET status = 'failed' WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
        [userId]
      );

      return res.status(400).json({
        ok: false,
        error: "Failed to process withdrawal",
        txResult,
        engine_result: result.result?.engine_result,
        engine_result_message: result.result?.engine_result_message,
        txHash: result.result?.hash,
      });
    }

    // Process fiat withdrawal
    // In production, this would trigger actual bank transfer or PayNow payout
    const withdrawalId = `wd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Update withdrawal record
    db.run(
      `UPDATE withdrawals SET status = 'processing', tx_hash = ? 
       WHERE user_id = ? AND status = 'pending' ORDER BY id DESC LIMIT 1`,
      [result.result?.hash, userId]
    );

    // TODO: Integrate with payment gateway for actual fiat payout
    // For bank transfer: Use Stripe Connect, Plaid, or bank API
    // For PayNow: Use PayNow API to send money

    return res.json({
      ok: true,
      txHash: result.result?.hash,
      txResult,
      amountXlusd: Number(amountXlusd),
      amountUsd,
      withdrawalId,
      withdrawalMethod,
      status: "processing",
      message: "Withdrawal initiated. Funds will be transferred within 1-3 business days.",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

// GET WITHDRAWAL HISTORY
app.get("/api/withdrawals", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id;
    
    db.all(
      `SELECT * FROM withdrawals WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
      [userId],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: "Database error" });
        }
        
        const withdrawals = rows.map(row => ({
          id: row.id,
          amountXlusd: row.amount_xlusd,
          amountUsd: row.amount_usd,
          withdrawalMethod: row.withdrawal_method,
          accountDetails: JSON.parse(row.account_details || "{}"),
          status: row.status,
          txHash: row.tx_hash,
          createdAt: row.created_at,
        }));

        return res.json({
          ok: true,
          withdrawals,
        });
      }
    );
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// BUY XLUSD (Create DEX order to buy XLUSD with XRP) - kept for backward compatibility
app.post("/api/xlusd/buy", requireAuth, async (req, res) => {
  let client;
  try {
    const { amountXlusd, maxPriceXrp } = req.body || {};

    if (!amountXlusd || !Number.isFinite(Number(amountXlusd))) {
      return res.status(400).json({ error: "Invalid amountXlusd" });
    }

    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "Missing PAYER_SEED" });
    }

    const buyerWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    client = await getClient();

    // XLUSD issuer and currency
    const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
    const xlusdCurrency = "XLUSD";

    // Get current order book to determine price
    const orderBook = await client.request({
      command: "book_offers",
      taker_pays: {
        currency: "XRP",
      },
      taker_gets: {
        currency: xlusdCurrency,
        issuer: xlusdIssuer,
      },
      limit: 10,
    });

    // If no orders available, return error
    if (!orderBook.result.offers || orderBook.result.offers.length === 0) {
      return res.status(400).json({ 
        error: "No XLUSD offers available on DEX. You may need to create a trustline first." 
      });
    }

    // Use the best available price, or use maxPriceXrp if provided
    const bestOffer = orderBook.result.offers[0];
    const takerGets = bestOffer.TakerGets;
    const takerPays = bestOffer.TakerPays;
    
    // Calculate price: XRP per XLUSD
    const xrpAmount = typeof takerPays === "string" 
      ? parseFloat(xrpl.dropsToXrp(takerPays))
      : parseFloat(takerPays.value || 0);
    const xlusdAmount = typeof takerGets === "string"
      ? parseFloat(takerGets)
      : parseFloat(takerGets.value || 0);
    
    const pricePerXlusd = xlusdAmount > 0 ? xrpAmount / xlusdAmount : 0;
    const totalXrpNeeded = Number(amountXlusd) * pricePerXlusd;

    // If maxPriceXrp is provided and total exceeds it, reject
    if (maxPriceXrp && totalXrpNeeded > Number(maxPriceXrp)) {
      return res.status(400).json({ 
        error: `Price too high. Need ${totalXrpNeeded} XRP but max is ${maxPriceXrp}` 
      });
    }

    // Create a payment to buy XLUSD
    // For simplicity, we'll create an offer (limit order)
    const tx = {
      TransactionType: "OfferCreate",
      Account: buyerWallet.classicAddress,
      TakerGets: {
        currency: xlusdCurrency,
        issuer: xlusdIssuer,
        value: String(amountXlusd),
      },
      TakerPays: xrpl.xrpToDrops(String(totalXrpNeeded)),
    };

    const prepared = await client.autofill(tx);
    const signed = buyerWallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);

    const txResult = result.result?.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      return res.status(400).json({
        ok: false,
        txResult,
        engine_result: result.result?.engine_result,
        engine_result_message: result.result?.engine_result_message,
        txHash: result.result?.hash,
      });
    }

    return res.json({
      ok: true,
      txHash: result.result?.hash,
      txResult,
      amountXlusd: Number(amountXlusd),
      amountXrp: totalXrpNeeded,
      pricePerXlusd,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

/* ======================
   HISTORY & STATS
====================== */

// GET TRANSACTION HISTORY
app.get("/api/history", requireAuth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 50;
    
    // In a real app, this would query a database
    // For now, return mock data
    const history = [
      // Mock history entries
    ];

    return res.json({
      ok: true,
      history,
      total: history.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// GET STATISTICS
app.get("/api/stats", requireAuth, async (req, res) => {
  try {
    // In a real app, calculate from database
    // For now, return mock stats
    return res.json({
      ok: true,
      totalEscrows: 0,
      totalValue: 0,
      completed: 0,
      pending: 0,
      xlusdBalance: 0,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// GET/SET SETTINGS
app.get("/api/settings", requireAuth, async (req, res) => {
  try {
    // In a real app, load from database
    return res.json({
      ok: true,
      settings: {
        emailNotifications: true,
        transactionAlerts: true,
        network: "testnet",
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

app.post("/api/settings", requireAuth, async (req, res) => {
  try {
    const { emailNotifications, transactionAlerts, network } = req.body || {};
    
    // In a real app, save to database
    // For now, just return success
    
    return res.json({
      ok: true,
      settings: {
        emailNotifications: emailNotifications !== false,
        transactionAlerts: transactionAlerts !== false,
        network: network || "testnet",
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

/* ======================
   TEST ENDPOINTS (Development)
====================== */

// Test wallet connection and XLUSD info
app.get("/api/test/wallet", async (req, res) => {
  let client;
  try {
    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "PAYER_SEED not configured" });
    }

    try {
      const wallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
      client = await getClient();

      // Get account info
      const accountInfo = await client.request({
        command: "account_info",
        account: wallet.classicAddress,
        ledger_index: "validated",
      });

      const xrpBalance = xrpl.dropsToXrp(accountInfo.result.account_data.Balance);

      // Get XLUSD balance
      const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
      const accountLines = await client.request({
        command: "account_lines",
        account: wallet.classicAddress,
        ledger_index: "validated",
      });

      const xlusdLine = accountLines.result.lines?.find(
        (line) => line.currency === "XLUSD" && line.account === xlusdIssuer
      );

      // Check DEX price
      let dexPrice = null;
      try {
        const orderBook = await client.request({
          command: "book_offers",
          taker_pays: { currency: "XRP" },
          taker_gets: { currency: "XLUSD", issuer: xlusdIssuer },
          limit: 1,
        });

        if (orderBook.result.offers && orderBook.result.offers.length > 0) {
          const offer = orderBook.result.offers[0];
          const xrp = typeof offer.TakerPays === "string" 
            ? parseFloat(xrpl.dropsToXrp(offer.TakerPays))
            : parseFloat(offer.TakerPays.value || 0);
          const xlusd = typeof offer.TakerGets === "string"
            ? parseFloat(offer.TakerGets)
            : parseFloat(offer.TakerGets.value || 0);
          dexPrice = xlusd > 0 ? xrp / xlusd : null;
        }
      } catch (err) {
        // DEX check failed, that's OK
      }

      return res.json({
        ok: true,
        wallet: {
          address: wallet.classicAddress,
          xrpBalance: parseFloat(xrpBalance),
          xlusdBalance: xlusdLine ? parseFloat(xlusdLine.balance) : 0,
          hasTrustline: !!xlusdLine,
        },
        xlusd: {
          issuer: xlusdIssuer,
          purchasePrice: 1.0, // $1 USD per XLUSD
          dexPrice: dexPrice,
          availableOnDEX: dexPrice !== null,
        },
      });
    } catch (seedErr) {
      return res.status(400).json({
        error: "Invalid PAYER_SEED format",
        message: seedErr.message,
        hint: "Seed should start with 's' and contain no underscores",
      });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

/* ======================
   START
====================== */

const PORT = 3001;
app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
  console.log(`📊 Test wallet: http://localhost:${PORT}/api/test/wallet`);
});
