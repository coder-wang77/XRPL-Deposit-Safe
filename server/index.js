import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import xrpl from "xrpl";
import session from "express-session";
import bcrypt from "bcrypt";
import crypto from "crypto";

import db from "./db.js";
import dbPromise from "./utils/db-promise.js";
import {
  getClient,
  createEscrow,
  finishEscrow,
  cancelEscrow,
  generateConditionPair,
  createCondition,
  validatePreimage,
  createFreelancerEscrow,
  createQAEscrow,
  dropsToXrp,
  xrpToDrops,
} from "./xrpl.js";
import AIChecker from "./ai-checker.js";
import {
  isValidXRPLAddress,
  isValidXRPLSeed,
  normalizeSeed,
  isValidAmount,
  isValidUnixTimestamp,
  isValidEmail,
  isValidPaymentMethod,
  isValidWithdrawalMethod,
} from "./utils/validation.js";
import {
  XRPL_CONSTANTS,
  DEFAULT_XLUSD_ISSUER,
  XLUSD_CURRENCY,
  XLUSD_PRICE_USD,
  PAYMENT_METHODS,
  WITHDRAWAL_METHODS,
  PAYMENT_STATUS,
  WITHDRAWAL_STATUS,
  CORS_ALLOWED_ORIGINS,
  CORS_DEV_PATTERNS,
} from "./utils/constants.js";

// ======================
// XLUSD conversion helpers (XRP -> XLUSD)
// ======================

// ======================
// Fake Bank helpers (USD ledger)
// ======================

async function recordBankTransaction({ userId, direction, amountUsd, reference = null, metadata = {} }) {
  if (!userId) throw new Error("recordBankTransaction: missing userId");
  const amt = Number(amountUsd);
  if (!Number.isFinite(amt) || amt <= 0) throw new Error("recordBankTransaction: invalid amountUsd");
  if (direction !== "in" && direction !== "out") throw new Error("recordBankTransaction: invalid direction");

  // Avoid double-recording if the same reference is reused (best-effort)
  if (reference) {
    const existing = await dbPromise.get(
      `SELECT id FROM bank_transactions WHERE reference = ? AND direction = ? LIMIT 1`,
      [reference, direction]
    );
    if (existing?.id) return;
  }

  await dbPromise.run(
    `INSERT INTO bank_transactions (user_id, direction, amount_usd, reference, status, metadata)
     VALUES (?, ?, ?, ?, 'completed', ?)`,
    [userId, direction, amt, reference, JSON.stringify(metadata || {})]
  );
}

async function getBankBalanceUsd(userId) {
  const inRow = await dbPromise.get(
    `SELECT COALESCE(SUM(amount_usd), 0) AS total_in
     FROM bank_transactions
     WHERE user_id = ? AND direction = 'in' AND status = 'completed'`,
    [userId]
  );
  const outRow = await dbPromise.get(
    `SELECT COALESCE(SUM(amount_usd), 0) AS total_out
     FROM bank_transactions
     WHERE user_id = ? AND direction = 'out' AND status = 'completed'`,
    [userId]
  );

  const totalIn = Number(inRow?.total_in || 0);
  const totalOut = Number(outRow?.total_out || 0);
  return Math.max(0, totalIn - totalOut);
}

async function ensureXlusdTrustline({ client, wallet, issuer }) {
  const lines = await client.request({
    command: "account_lines",
    account: wallet.classicAddress,
    ledger_index: "validated",
  });

  const hasTrustline = lines.result.lines?.some(
    (line) => line.currency === XLUSD_CURRENCY && line.account === issuer
  );

  if (hasTrustline) return { created: false };

  const trustlineTx = {
    TransactionType: "TrustSet",
    Account: wallet.classicAddress,
    LimitAmount: {
      currency: XLUSD_CURRENCY,
      issuer,
      value: "1000000",
    },
  };

  const prepared = await client.autofill(trustlineTx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const txResult = result.result?.meta?.TransactionResult;
  if (txResult !== "tesSUCCESS") {
    throw new Error(
      `Failed to create XLUSD trustline: ${result.result?.engine_result_message || txResult}`
    );
  }

  return { created: true, txHash: result.result?.hash };
}

function parseDeliveredXlusd(delivered) {
  // delivered can be an object (IOU) or string (XRP drops)
  if (!delivered) return null;
  if (typeof delivered === "object" && delivered.currency === XLUSD_CURRENCY) {
    const v = Number(delivered.value);
    return Number.isFinite(v) ? v : null;
  }
  return null;
}

async function convertEscrowXrpToXlusd({ client, wallet, issuer, escrowAmountDrops }) {
  if (!escrowAmountDrops) {
    return { ok: false, skipped: true, reason: "Unknown escrow amount" };
  }

  // Safety: don't accidentally spend below base reserve
  const reserveBufferXrp = 15; // conservative buffer on testnet
  const reserveBufferDrops = BigInt(xrpToDrops(String(reserveBufferXrp)));

  const info = await client.request({
    command: "account_info",
    account: wallet.classicAddress,
    ledger_index: "validated",
  });

  const balanceDrops = BigInt(info.result.account_data?.Balance || "0");
  const spendableDrops = balanceDrops > reserveBufferDrops ? balanceDrops - reserveBufferDrops : 0n;
  const escrowDrops = BigInt(String(escrowAmountDrops));
  const maxSpendDrops = spendableDrops < escrowDrops ? spendableDrops : escrowDrops;

  if (maxSpendDrops <= 0n) {
    return { ok: false, skipped: true, reason: "Insufficient XRP to convert (reserve buffer)" };
  }

  await ensureXlusdTrustline({ client, wallet, issuer });

  // Convert by making a self-payment that requests XLUSD and spends up to SendMax XRP.
  // This uses rippled pathfinding + orderbook offers. Not guaranteed to fill (depends on liquidity).
  const tx = {
    TransactionType: "Payment",
    Account: wallet.classicAddress,
    Destination: wallet.classicAddress,
    Amount: {
      currency: XLUSD_CURRENCY,
      issuer,
      value: "1000000000", // very large; actual delivered is limited by SendMax + liquidity
    },
    SendMax: maxSpendDrops.toString(), // XRP drops
    Flags: xrpl.PaymentFlags.tfPartialPayment,
  };

  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);
  const txResult = result.result?.meta?.TransactionResult;

  if (txResult !== "tesSUCCESS") {
    return {
      ok: false,
      skipped: false,
      txResult,
      txHash: result.result?.hash,
      error: result.result?.engine_result_message || `Conversion failed: ${txResult}`,
    };
  }

  const meta = result.result?.meta;
  const delivered = meta?.delivered_amount || meta?.DeliveredAmount || null;
  const deliveredXlusd = parseDeliveredXlusd(delivered);

  return {
    ok: true,
    txHash: result.result?.hash,
    txResult,
    spentXrp: Number(dropsToXrp(maxSpendDrops.toString())),
    deliveredXlusd,
  };
}

dotenv.config();

const app = express();

function isValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// XLUSD <-> XRP conversion (fixed rate for now)
// Interpretation: 2.12 XLUSD per 1 XRP  =>  xrp = xlusd / 2.12
const XLUSD_PER_XRP = Number(process.env.XLUSD_PER_XRP || "2.12");
if (!Number.isFinite(XLUSD_PER_XRP) || XLUSD_PER_XRP <= 0) {
  throw new Error("Invalid XLUSD_PER_XRP. Must be a positive number.");
}

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

// CORS for Live Server, development, and live demos (ngrok, localtunnel, etc.)
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, Postman, or file://)
      if (!origin) return callback(null, true);
      
      // Check allowed origins
      if (CORS_ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      
      // In development/demo, allow:
      // - localhost origins
      // - ngrok domains (for live demos)
      // - localtunnel domains (for live demos)
      // - Cloudflare tunnel domains
      if (process.env.NODE_ENV !== "production") {
        if (
          origin.includes("localhost") || 
          origin.includes("127.0.0.1") ||
          CORS_DEV_PATTERNS.some(pattern => pattern.test(origin))
        ) {
          return callback(null, true);
        }
      }
      
      callback(new Error("Not allowed by CORS"));
    },
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
      maxAge: XRPL_CONSTANTS.DEFAULT_SESSION_MAX_AGE, // default 2 hours
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

// ======================
// WALLET ENCRYPTION UTILITIES
// ======================

function getEncryptionKey() {
  // Use SESSION_SECRET as encryption key (in production, use a separate WALLET_ENCRYPTION_KEY)
  const key = process.env.WALLET_ENCRYPTION_KEY || process.env.SESSION_SECRET || "DEV_ONLY_CHANGE_ME";
  // Ensure key is 32 bytes for AES-256
  return crypto.createHash("sha256").update(key).digest();
}

function encryptSeed(seed) {
  const algorithm = "aes-256-cbc";
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(algorithm, key, iv);
  let encrypted = cipher.update(seed, "utf8", "hex");
  encrypted += cipher.final("hex");
  return iv.toString("hex") + ":" + encrypted;
}

function decryptSeed(encryptedSeed) {
  try {
    const algorithm = "aes-256-cbc";
    const key = getEncryptionKey();
    const parts = encryptedSeed.split(":");
    if (parts.length !== 2) {
      throw new Error("Invalid encrypted seed format");
    }
    const iv = Buffer.from(parts[0], "hex");
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (err) {
    throw new Error("Failed to decrypt wallet seed: " + err.message);
  }
}

// Use validation utility instead
const validateXRPLSeed = isValidXRPLSeed;

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

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const cleanEmail = email.toLowerCase().trim();
    const hash = await bcrypt.hash(password, 12);

    try {
      const result = await dbPromise.run(
        "INSERT INTO users (email, password_hash) VALUES (?, ?)",
        [cleanEmail, hash]
      );

      // session
      req.session.user = { id: result.lastID, email: cleanEmail };

      // remember me: 7 days
      if (rememberMe) {
        req.session.cookie.maxAge = XRPL_CONSTANTS.REMEMBER_ME_MAX_AGE;
      }

      return res.json({ ok: true, user: { email: cleanEmail } });
    } catch (dbErr) {
      if (dbErr.message.includes("UNIQUE")) {
        return res.status(409).json({ error: "Email already exists" });
      }
      console.error("DB INSERT ERROR:", dbErr);
      return res.status(500).json({ error: "Database error" });
    }
  } catch (e) {
    console.error("SIGNUP ERROR:", e);
    return res.status(500).json({ error: "Server error" });
  }
});

// LOGIN
app.post("/api/login", async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password required" });
    }

    const cleanEmail = email.toLowerCase().trim();

    const user = await dbPromise.get("SELECT * FROM users WHERE email = ?", [cleanEmail]);

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
      req.session.cookie.maxAge = XRPL_CONSTANTS.REMEMBER_ME_MAX_AGE;
    } else {
      req.session.cookie.maxAge = XRPL_CONSTANTS.DEFAULT_SESSION_MAX_AGE; // 2 hours
    }

    return res.json({ ok: true, user: { email: user.email } });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    return res.status(500).json({ error: "Database error" });
  }
});

// WHO AM I
app.get("/api/me", async (req, res) => {
  if (!req.session?.user) {
    return res.status(401).json({ error: "Not logged in" });
  }
  
  try {
    // Get wallet info if connected
    const wallet = await dbPromise.get(
      "SELECT wallet_address, is_verified FROM user_wallets WHERE user_id = ?",
      [req.session.user.id]
    );
    
    return res.json({
      ok: true,
      user: req.session.user,
      wallet: wallet ? {
        address: wallet.wallet_address,
        isVerified: !!wallet.is_verified,
      } : null,
    });
  } catch (err) {
    console.error("Error fetching wallet:", err);
    return res.json({ ok: true, user: req.session.user, wallet: null });
  }
});

/* ======================
   WALLET CONNECTION
====================== */

// CONNECT WALLET (store encrypted seed)
app.post("/api/wallet/connect", requireAuth, async (req, res) => {
  try {
    const { seed } = req.body || {};
    const userId = req.session.user.id;

    if (!seed) {
      return res.status(400).json({ error: "Wallet seed is required" });
    }

    // Normalize the seed - remove all whitespace and ensure proper encoding
    const trimmedSeed = normalizeSeed(seed);

    // Basic format check
    if (!isValidXRPLSeed(trimmedSeed)) {
      return res.status(400).json({ 
        error: "Invalid wallet seed format. XRPL seeds must start with 's' and be 25-35 characters long. Make sure you're copying the seed (secret), not the address." 
      });
    }

    // Try to create wallet - this is the most reliable validation
    let wallet;
    try {
      wallet = xrpl.Wallet.fromSeed(trimmedSeed);
    } catch (err) {
      // Provide more helpful error messages
      let errorMsg = err.message || err.toString() || "Unknown error";
      
      // Check for specific error patterns
      if (errorMsg.includes("pattern") || errorMsg.includes("expected pattern")) {
        errorMsg = `The seed format doesn't match XRPL requirements. Please check:\n\n` +
          `1. Make sure you copied the complete seed (usually 29-31 characters)\n` +
          `2. The seed should start with 's' followed by letters and numbers only\n` +
          `3. No spaces, line breaks, or special characters\n` +
          `4. Use the Secret/Seed from the faucet, NOT the Address\n\n` +
          `Your seed length: ${trimmedSeed.length} characters\n` +
          `First 10 chars: ${trimmedSeed.substring(0, 10)}...\n\n` +
          `If this persists, try generating a new wallet at: https://xrpl.org/xrp-testnet-faucet.html`;
      } else if (errorMsg.includes("checksum")) {
        errorMsg = `Invalid seed checksum. The seed appears to be corrupted or incomplete.\n\n` +
          `Please copy the seed again from the XRPL faucet and try again.`;
      } else {
        errorMsg = `Wallet validation failed: ${errorMsg}\n\n` +
          `Please verify you copied the complete seed correctly.`;
      }
      
      return res.status(400).json({ 
        error: errorMsg
      });
    }

    const walletAddress = wallet.classicAddress;
    const encryptedSeed = encryptSeed(trimmedSeed);

    // Check if user already has a wallet
    db.get(
      "SELECT id FROM user_wallets WHERE user_id = ?",
      [userId],
      (err, existing) => {
        if (err) {
          console.error("DB error:", err);
          return res.status(500).json({ error: "Database error" });
        }

        if (existing) {
          // Update existing wallet
          db.run(
            `UPDATE user_wallets 
             SET wallet_address = ?, encrypted_seed = ?, is_verified = 0, updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?`,
            [walletAddress, encryptedSeed, userId],
            function (updateErr) {
              if (updateErr) {
                console.error("Update error:", updateErr);
                return res.status(500).json({ error: "Failed to update wallet" });
              }
              return res.json({
                ok: true,
                wallet: { address: walletAddress, isVerified: false },
                message: "Wallet updated. Please verify ownership.",
              });
            }
          );
        } else {
          // Insert new wallet
          db.run(
            `INSERT INTO user_wallets (user_id, wallet_address, encrypted_seed, is_verified)
             VALUES (?, ?, ?, 0)`,
            [userId, walletAddress, encryptedSeed],
            function (insertErr) {
              if (insertErr) {
                console.error("Insert error:", insertErr);
                return res.status(500).json({ error: "Failed to connect wallet" });
              }
              return res.json({
                ok: true,
                wallet: { address: walletAddress, isVerified: false },
                message: "Wallet connected. Please verify ownership.",
              });
            }
          );
        }
      }
    );
  } catch (err) {
    console.error("Wallet connect error:", err);
    return res.status(500).json({ error: err.message || "Server error" });
  }
});

// VERIFY WALLET OWNERSHIP (checks wallet exists on XRPL)
app.post("/api/wallet/verify", requireAuth, async (req, res) => {
  let client;
  try {
    const userId = req.session.user.id;

    // Get user's wallet
    db.get(
      "SELECT encrypted_seed, wallet_address FROM user_wallets WHERE user_id = ?",
      [userId],
      async (err, wallet) => {
        if (err || !wallet) {
          return res.status(404).json({ ok: false, error: "Wallet not connected. Please connect your wallet first." });
        }

        try {
          // Verify by checking wallet exists and is valid on XRPL
          client = await getClient();

          let accountInfo;
          try {
            accountInfo = await client.request({
              command: "account_info",
              account: wallet.wallet_address,
              ledger_index: "validated",
            });
          } catch (apiErr) {
            // If account doesn't exist, it might not be funded yet
            if (apiErr.data?.error === "actNotFound") {
              if (client) await client.disconnect();
              return res.status(400).json({ 
                ok: false,
                error: "Wallet address not found on XRPL. Make sure the wallet has been funded with XRP (even a small amount) to activate it on the ledger.",
                walletAddress: wallet.wallet_address,
              });
            }
            throw apiErr;
          }

          if (accountInfo.result.account_data) {
            // Get wallet balance
            const balanceDrops = accountInfo.result.account_data.Balance || "0";
            const balanceXrp = parseFloat(dropsToXrp(balanceDrops));
            
            // Verify seed matches address (sanity check)
            try {
              const seed = decryptSeed(wallet.encrypted_seed);
              const userWallet = xrpl.Wallet.fromSeed(seed);
              
              if (userWallet.classicAddress !== wallet.wallet_address) {
                return res.status(400).json({ 
                  ok: false,
                  error: "Wallet seed doesn't match stored address. Please reconnect your wallet." 
                });
              }
            } catch (decryptErr) {
              console.error("Decrypt error during verify:", decryptErr);
              return res.status(500).json({ ok: false, error: "Failed to validate wallet seed" });
            }

            // Wallet exists and is valid - mark as verified
            db.run(
              `UPDATE user_wallets 
               SET is_verified = 1, verified_at = CURRENT_TIMESTAMP 
               WHERE user_id = ?`,
              [userId],
              async function (updateErr) {
                if (updateErr) {
                  console.error("Verify update error:", updateErr);
                  return res.status(500).json({ ok: false, error: "Failed to update verification status" });
                }
                return res.json({
                  ok: true,
                  wallet: {
                    address: wallet.wallet_address,
                    isVerified: true,
                    balanceXrp: balanceXrp,
                  },
                  message: "Wallet verified successfully!",
                });
              }
            );
          } else {
            return res.status(400).json({ error: "Wallet not found on XRPL ledger" });
          }
        } catch (verifyErr) {
          console.error("Verification error:", verifyErr);
          return res.status(400).json({ 
            ok: false,
            error: "Verification failed: " + (verifyErr.message || verifyErr.toString()),
            details: verifyErr.data?.error || "Unknown error"
          });
        }
      }
    );
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
  // Note: Client connection is reused via connection pool
});

// GET WALLET STATUS (balance, verification status, etc.)
app.get("/api/wallet/status", requireAuth, async (req, res) => {
  let client;
  try {
    const userId = req.session.user.id;
    
    // Check if we're in simulate mode
    const simulateXlusd = process.env.SIMULATE_XLUSD === "true" || 
                          process.env.TEST_MODE === "true" || 
                          process.env.FAKE_PAYMENTS === "true" ||
                          (!process.env.XLUSD_ISSUER_SEED && !process.env.PAYER_SEED);

    db.get(
      "SELECT wallet_address, is_verified, created_at, verified_at, COALESCE(simulated_balance_xrp, 0) as simulated_balance_xrp FROM user_wallets WHERE user_id = ?",
      [userId],
      async (err, wallet) => {
        if (err) {
          return res.status(500).json({ error: "Database error" });
        }

        if (!wallet) {
          return res.json({
            ok: true,
            connected: false,
            wallet: null,
          });
        }

        const simulatedBalance = parseFloat(wallet.simulated_balance_xrp) || 0;

        // In simulate mode, return simulated balance directly without checking XRPL
        if (simulateXlusd && simulatedBalance > 0) {
          return res.json({
            ok: true,
            connected: true,
            verified: !!wallet.is_verified,
            wallet: {
              address: wallet.wallet_address,
              existsOnLedger: null,
              balanceXrp: simulatedBalance,
              simulated: true,
              createdAt: wallet.created_at,
              verifiedAt: wallet.verified_at,
            },
          });
        }

        // Get live wallet status from XRPL
        try {
          client = await getClient();

          let accountInfo;
          try {
            accountInfo = await client.request({
              command: "account_info",
              account: wallet.wallet_address,
              ledger_index: "validated",
            });
          } catch (apiErr) {
            if (apiErr.data?.error === "actNotFound") {
              // If wallet doesn't exist on XRPL but we have simulated balance, use that
              if (simulatedBalance > 0) {
                return res.json({
                  ok: true,
                  connected: true,
                  verified: !!wallet.is_verified,
                  wallet: {
                    address: wallet.wallet_address,
                    existsOnLedger: false,
                    balanceXrp: simulatedBalance,
                    simulated: true,
                    message: "Wallet not activated on XRPL. Using simulated balance.",
                  },
                });
              }
              return res.json({
                ok: true,
                connected: true,
                verified: !!wallet.is_verified,
                wallet: {
                  address: wallet.wallet_address,
                  existsOnLedger: false,
                  balanceXrp: 0,
                  message: "Wallet not activated on XRPL. Fund it with XRP to activate.",
                },
              });
            }
            throw apiErr;
          }

          const balanceDrops = accountInfo.result.account_data?.Balance || "0";
          const balanceXrp = parseFloat(dropsToXrp(balanceDrops));
          const sequence = accountInfo.result.account_data?.Sequence || 0;
          
          // Combine real XRPL balance with simulated balance
          const totalBalance = balanceXrp + simulatedBalance;

          return res.json({
            ok: true,
            connected: true,
            verified: !!wallet.is_verified,
            wallet: {
              address: wallet.wallet_address,
              existsOnLedger: true,
              balanceXrp: totalBalance,
              xrplBalance: balanceXrp,
              simulatedBalance: simulatedBalance,
              sequence: sequence,
              createdAt: wallet.created_at,
              verifiedAt: wallet.verified_at,
            },
          });
        } catch (statusErr) {
          console.error("Status check error:", statusErr);
          // On error, fall back to simulated balance if available
          if (simulatedBalance > 0) {
            return res.json({
              ok: true,
              connected: true,
              verified: !!wallet.is_verified,
              wallet: {
                address: wallet.wallet_address,
                existsOnLedger: null,
                balanceXrp: simulatedBalance,
                simulated: true,
                error: statusErr.message,
              },
            });
          }
          return res.json({
            ok: true,
            connected: true,
            verified: !!wallet.is_verified,
            wallet: {
              address: wallet.wallet_address,
              existsOnLedger: null,
              error: statusErr.message,
            },
          });
        } finally {
          if (client) await client.disconnect();
        }
      }
    );
  } catch (err) {
    return res.status(500).json({ error: err.message || "Server error" });
  }
  // Note: Client connection is reused via connection pool
});

// GET USER WALLET
app.get("/api/wallet", requireAuth, (req, res) => {
  const userId = req.session.user.id;

  db.get(
    "SELECT wallet_address, is_verified, created_at, verified_at FROM user_wallets WHERE user_id = ?",
    [userId],
    (err, wallet) => {
      if (err) {
        console.error("DB error:", err);
        return res.status(500).json({ error: "Database error" });
      }

      if (!wallet) {
        return res.json({ ok: true, wallet: null });
      }

      return res.json({
        ok: true,
        wallet: {
          address: wallet.wallet_address,
          isVerified: !!wallet.is_verified,
          createdAt: wallet.created_at,
          verifiedAt: wallet.verified_at,
        },
      });
    }
  );
});

// GET USER WALLET (for internal use - returns decrypted seed)
function getUserWallet(userId, callback) {
  db.get(
    "SELECT encrypted_seed, wallet_address FROM user_wallets WHERE user_id = ? AND is_verified = 1",
    [userId],
    (err, wallet) => {
      if (err || !wallet) {
        return callback(err || new Error("Wallet not found or not verified"), null);
      }

      try {
        const seed = decryptSeed(wallet.encrypted_seed);
        const xrplWallet = xrpl.Wallet.fromSeed(seed);
        return callback(null, xrplWallet);
      } catch (decryptErr) {
        return callback(decryptErr, null);
      }
    }
  );
}

// Get user wallet (including unverified - for escrow creation)
function getUserWalletAny(userId, callback) {
  db.get(
    "SELECT encrypted_seed, wallet_address, is_verified FROM user_wallets WHERE user_id = ?",
    [userId],
    (err, wallet) => {
      if (err || !wallet) {
        return callback(err || new Error("Wallet not found"), null);
      }

      try {
        const seed = decryptSeed(wallet.encrypted_seed);
        const xrplWallet = xrpl.Wallet.fromSeed(seed);
        return callback(null, xrplWallet);
      } catch (decryptErr) {
        return callback(decryptErr, null);
      }
    }
  );
}

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
    const { payeeAddress, amountXrp, amountXlusd, finishAfterUnix, cancelAfterUnix, condition } =
      req.body || {};
    const userId = req.session.user.id;

    // Basic validation - detailed validation happens in createEscrow
    if (!payeeAddress || typeof payeeAddress !== "string") {
      return res.status(400).json({ error: "Missing or invalid payeeAddress" });
    }

    if (amountXrp === undefined && amountXlusd === undefined) {
      return res.status(400).json({ error: "Missing amountXlusd" });
    }

    if (!finishAfterUnix) {
      return res.status(400).json({ error: "Missing finishAfterUnix" });
    }

    const amountToLockXrp =
      amountXlusd !== undefined
        ? Number(amountXlusd) / XLUSD_PER_XRP
        : Number(amountXrp);

    if (!Number.isFinite(amountToLockXrp) || amountToLockXrp <= 0) {
      return res.status(400).json({ error: "Invalid amountXlusd" });
    }

    // Try to use user's wallet first (including unverified), fallback to server wallet
    let payerWallet;
    try {
      const userWallet = await new Promise((resolve, reject) => {
        getUserWalletAny(userId, (err, wallet) => {
          if (err) reject(err);
          else resolve(wallet);
        });
      });
      payerWallet = userWallet;
    } catch (err) {
      // Fallback to server wallet
    if (!process.env.PAYER_SEED) {
        return res.status(400).json({ 
          error: "No wallet connected. Please connect your XRP wallet first, or server PAYER_SEED must be configured." 
        });
      }
      payerWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    }

    client = await getClient();

    const { result, offerSequence } = await createEscrow({
      client,
      payerWallet,
      payeeAddress: payeeAddress.trim(),
      amountXrp: amountToLockXrp,
      finishAfterUnix,
      cancelAfterUnix,
      condition: condition || null, // Optional conditional escrow
    });

    const txResult = result.result?.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      return res.status(400).json({
        ok: false,
        txResult,
        engine_result: result.result?.engine_result,
        engine_result_message: result.result?.engine_result_message,
        txHash: result.result?.hash,
        error: result.result?.engine_result_message || `Transaction failed: ${txResult}`,
      });
    }

    return res.json({
      ok: true,
      txHash: result.result?.hash,
      offerSequence,
      txResult,
      amountXlusd: amountXlusd !== undefined ? Number(amountXlusd) : null,
      amountXrpLocked: Number(amountToLockXrp),
      xlusdPerXrp: XLUSD_PER_XRP,
      payeeAddress: payeeAddress.trim(),
      hasCondition: !!condition,
      condition: condition || null,
    });
  } catch (err) {
    // Handle validation errors with 400, server errors with 500
    const statusCode = err.message?.includes("Invalid") || 
                       err.message?.includes("must be") ||
                       err.message?.includes("Cannot") ||
                       err.message?.includes("Too early") ||
                       err.message?.includes("not found") ||
                       err.message?.includes("Not authorized")
                       ? 400 : 500;
    
    return res.status(statusCode).json({ 
      error: err.message || String(err),
      ok: false,
    });
  } finally {
    if (client) await client.disconnect();
  }
});

// FINISH ESCROW
app.post("/escrow/finish", requireAuth, async (req, res) => {
  let client;
  try {
    const { ownerAddress, offerSequence, fulfillment } = req.body || {};
    const userId = req.session.user.id;
    
    if (!ownerAddress || typeof ownerAddress !== "string" || ownerAddress.trim() === "") {
      return res.status(400).json({ error: "Missing or invalid ownerAddress" });
    }

    if (offerSequence === undefined || offerSequence === null || offerSequence === "") {
      return res.status(400).json({ error: "Missing offerSequence" });
    }

    // Try to use user's wallet first (for service provider finishing escrow)
    let payeeWallet;
    let usingFallbackWallet = false;
    try {
      const userWallet = await new Promise((resolve, reject) => {
        getUserWalletAny(userId, (err, wallet) => {
          if (err) reject(err);
          else resolve(wallet);
        });
      });
      payeeWallet = userWallet;
    } catch (err) {
      // Fallback to server wallet
      if (!process.env.PAYEE_SEED && !process.env.PAYER_SEED) {
        return res.status(400).json({ 
          error: "No wallet connected. Please connect your XRP wallet to finish escrows, or server PAYEE_SEED/PAYER_SEED must be configured." 
        });
      }
      const seed = process.env.PAYEE_SEED || process.env.PAYER_SEED;
      payeeWallet = xrpl.Wallet.fromSeed(seed);
      usingFallbackWallet = true;
    }

    client = await getClient();

    const out = await finishEscrow({
      client,
      payeeWallet,
      ownerAddress: ownerAddress.trim(),
      offerSequence,
      fulfillment: fulfillment || null, // Optional fulfillment for conditional escrows
    });

    const isSuccess = out.txResult === "tesSUCCESS";

    // Optional: auto-convert received XRP into XLUSD so balances don't fluctuate.
    // Escrow itself remains XRP on-ledger (EscrowCreate only supports XRP).
    let conversion = null;
    const autoConvert = (process.env.AUTO_CONVERT_TO_XLUSD || "true") === "true";
    if (isSuccess && autoConvert) {
      if (usingFallbackWallet) {
        conversion = {
          ok: false,
          skipped: true,
          reason: "Using server fallback wallet; connect your own wallet to auto-convert on unlock",
        };
      } else {
        try {
          const issuer = process.env.XLUSD_ISSUER || DEFAULT_XLUSD_ISSUER;
          conversion = await convertEscrowXrpToXlusd({
            client,
            wallet: payeeWallet,
            issuer,
            escrowAmountDrops: out.escrowAmountDrops,
          });
        } catch (convErr) {
          conversion = {
            ok: false,
            skipped: false,
            error: convErr.message || String(convErr),
          };
        }
      }
    }

    return res.status(isSuccess ? 200 : 400).json({
      ok: isSuccess,
      txHash: out.hash,
      txResult: out.txResult,
      validated: out.validated,
      escrowAmountDrops: out.escrowAmountDrops || null,
      autoConvertedToXlusd: autoConvert,
      conversion,
      error: isSuccess ? undefined : `Transaction failed: ${out.txResult}`,
    });
  } catch (err) {
    // Handle validation/authorization errors with 400, server errors with 500
    const statusCode = err.message?.includes("Invalid") || 
                       err.message?.includes("must be") ||
                       err.message?.includes("Not authorized") ||
                       err.message?.includes("Too early") ||
                       err.message?.includes("not found") ||
                       err.message?.includes("Entry not found")
                       ? 400 : 500;
    
    return res.status(statusCode).json({ 
      error: err.message || String(err),
      ok: false,
    });
  } finally {
    if (client) await client.disconnect();
  }
});

// CANCEL ESCROW
app.post("/escrow/cancel", requireAuth, async (req, res) => {
  let client;
  try {
    const { ownerAddress, offerSequence } = req.body || {};
    
    if (!ownerAddress || typeof ownerAddress !== "string" || ownerAddress.trim() === "") {
      return res.status(400).json({ error: "Missing or invalid ownerAddress" });
    }

    if (offerSequence === undefined || offerSequence === null || offerSequence === "") {
      return res.status(400).json({ error: "Missing offerSequence" });
    }

    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "Missing PAYER_SEED" });
    }

    const payerWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    client = await getClient();

    const out = await cancelEscrow({
      client,
      payerWallet,
      ownerAddress: ownerAddress.trim(),
      offerSequence,
    });

    const isSuccess = out.txResult === "tesSUCCESS";
    
    return res.status(isSuccess ? 200 : 400).json({
      ok: isSuccess,
      txHash: out.hash,
      txResult: out.txResult,
      validated: out.validated,
      error: isSuccess ? undefined : `Transaction failed: ${out.txResult}`,
    });
  } catch (err) {
    // Handle validation/authorization errors with 400, server errors with 500
    const statusCode = err.message?.includes("Invalid") || 
                       err.message?.includes("must be") ||
                       err.message?.includes("Not authorized") ||
                       err.message?.includes("Too early") ||
                       err.message?.includes("not found") ||
                       err.message?.includes("Entry not found") ||
                       err.message?.includes("no CancelAfter")
                       ? 400 : 500;
    
    return res.status(statusCode).json({ 
      error: err.message || String(err),
      ok: false,
    });
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

// Generate condition-fulfillment pair for conditional escrows
app.post("/escrow/generate-condition", requireAuth, (req, res) => {
  try {
    const { preimage } = req.body || {};
    
    let conditionPair;
    if (preimage) {
      // If preimage is provided, create condition from it
      const condition = createCondition(preimage);
      conditionPair = { preimage, condition };
    } else {
      // Generate a new random pair
      conditionPair = generateConditionPair();
    }
    
    return res.json({
      ok: true,
      ...conditionPair,
      note: "Save the preimage securely! You'll need it to finish the conditional escrow.",
    });
  } catch (err) {
    return res.status(400).json({
      error: err.message || String(err),
      ok: false,
    });
  }
});

// FREELANCER PAYMENT WORKFLOW
// Create escrow for freelancer payment: client locks payment → freelancer delivers → client releases
app.post("/escrow/freelancer/create", requireAuth, async (req, res) => {
  let client;
  try {
    const { freelancerAddress, amountXrp, deadlineUnix, preimage } = req.body || {};
    const userId = req.session.user.id;

    // Basic validation
    if (!freelancerAddress || typeof freelancerAddress !== "string") {
      return res.status(400).json({ error: "Missing or invalid freelancerAddress" });
    }

    if (!amountXrp) {
      return res.status(400).json({ error: "Missing amountXrp" });
    }

    if (!deadlineUnix) {
      return res.status(400).json({ error: "Missing deadlineUnix" });
    }

    const deadline = Number(deadlineUnix);
    const nowUnix = Math.floor(Date.now() / 1000);
    const minDeadlineUnix = nowUnix + 60; // Require at least 1 minute in the future (buffer for processing)
    
    if (!Number.isFinite(deadline) || deadline <= 0) {
      return res.status(400).json({ 
        error: "Invalid deadlineUnix: must be a positive number" 
      });
    }
    
    if (deadline <= minDeadlineUnix) {
      const minDate = new Date(minDeadlineUnix * 1000).toISOString();
      const providedDate = new Date(deadline * 1000).toISOString();
      return res.status(400).json({ 
        error: `deadlineUnix must be at least 1 minute in the future. Provided: ${providedDate}, Minimum: ${minDate}` 
      });
    }

    // Get user's verified wallet from database
    const userWalletData = await dbPromise.get(
      "SELECT wallet_address, encrypted_seed, is_verified FROM user_wallets WHERE user_id = ? AND is_verified = 1",
      [userId]
    );

    if (!userWalletData) {
      return res.status(400).json({ 
        error: "No verified wallet found. Please connect and verify your XRPL wallet first." 
      });
    }

    // Decrypt and load user's wallet
    let clientWallet;
    try {
      const seed = decryptSeed(userWalletData.encrypted_seed);
      clientWallet = xrpl.Wallet.fromSeed(seed);
    } catch (decryptErr) {
      return res.status(500).json({ error: "Failed to load user wallet: " + decryptErr.message });
    }

    client = await getClient();

    const escrowResult = await createFreelancerEscrow({
      client,
      clientWallet,
      freelancerAddress: freelancerAddress.trim(),
      amountXrp,
      deadlineUnix: deadline,
      preimage: preimage || null,
    });

    // createFreelancerEscrow returns { result, offerSequence, preimage, condition, deadlineUnix }
    // where result is the submitAndWait result from createEscrow
    // The submitAndWait result has a result property containing the transaction result
    const { result, offerSequence, preimage: resultPreimage, condition, deadlineUnix: resultDeadline } = escrowResult;
    const txResult = result?.result?.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      return res.status(400).json({
        ok: false,
        txResult,
        engine_result: result?.result?.engine_result,
        engine_result_message: result?.result?.engine_result_message,
        txHash: result?.result?.hash,
        error: result?.result?.engine_result_message || `Transaction failed: ${txResult}`,
      });
    }

    return res.json({
      ok: true,
      txHash: result?.result?.hash,
      offerSequence,
      txResult,
      amountXrp: Number(amountXrp),
      freelancerAddress: freelancerAddress.trim(),
      preimage: resultPreimage, // Client saves this to release payment when satisfied
      condition, // Can be shared with freelancer for transparency
      deadlineUnix: resultDeadline,
      workflow: "freelancer_payment",
      instructions: {
        client: "Save the preimage securely. Provide it to release payment when work is satisfactory.",
        freelancer: "Payment is locked. Deliver work. Client will release payment or auto-refund after deadline.",
      },
    });
  } catch (err) {
    const statusCode = err.message?.includes("Invalid") || 
                       err.message?.includes("must be") ||
                       err.message?.includes("Cannot")
                       ? 400 : 500;
    
    return res.status(statusCode).json({ 
      error: err.message || String(err),
      ok: false,
    });
  } finally {
    if (client) await client.disconnect();
  }
});

// QA ESCROW - Store requirements in memory (in production, use database)
const qaEscrowRequirements = {}; // {sequence: {requirements: [], preimage: string, condition: string}}

// Cleanup old QA escrow requirements (older than 30 days)
setInterval(() => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let cleaned = 0;
  for (const [sequence, data] of Object.entries(qaEscrowRequirements)) {
    if (data.createdAt && data.createdAt < thirtyDaysAgo) {
      delete qaEscrowRequirements[sequence];
      cleaned++;
    }
  }
  if (cleaned > 0) {
    console.log(`Cleaned up ${cleaned} old QA escrow requirements`);
  }
}, 24 * 60 * 60 * 1000); // Run daily

// CREATE QA ESCROW (with requirements checklist)
app.post("/escrow/qa/create", requireAuth, async (req, res) => {
  let client;
  try {
    const { providerAddress, amountXrp, amountXlusd, deadlineUnix, requirements } = req.body || {};
    const userId = req.session.user.id;

    // Basic validation
    if (!providerAddress || typeof providerAddress !== "string") {
      return res.status(400).json({ error: "Missing or invalid providerAddress" });
    }

    // Accept XLUSD amounts (app-level) and convert to XRP for on-ledger escrow locking.
    // NOTE: XRPL EscrowCreate only supports XRP; this is a UX abstraction.
    if (amountXlusd === undefined && amountXrp === undefined) {
      return res.status(400).json({ error: "Missing amountXlusd" });
    }

    if (!deadlineUnix) {
      return res.status(400).json({ error: "Missing deadlineUnix" });
    }

    // Requirements are optional - allow rich requirements:
    // - string: treated as { text: string, evidenceLinks: [] }
    // - object: { text: string, evidenceLinks?: string[] }
    const validRequirements = [];
    if (requirements && Array.isArray(requirements)) {
      for (const req of requirements) {
        if (!req) continue;
        if (typeof req === "string") {
          const text = req.trim();
          if (text.length > 0) validRequirements.push({ text, evidenceLinks: [] });
          continue;
        }
        if (typeof req === "object") {
          const text = String(req.text || "").trim();
          const evidenceLinks = Array.isArray(req.evidenceLinks)
            ? req.evidenceLinks.map((u) => String(u || "").trim()).filter((u) => u.length > 0)
            : [];
          if (text.length > 0 || evidenceLinks.length > 0) {
            validRequirements.push({ text, evidenceLinks });
          }
        }
      }
    }

    const deadline = Number(deadlineUnix);
    const nowUnix = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(deadline) || deadline <= nowUnix) {
      return res.status(400).json({ 
        error: "deadlineUnix must be a future timestamp" 
      });
    }

    // Determine XRP amount to lock on-ledger (2.12 XLUSD per 1 XRP => xrp = xlusd / 2.12)
    const xlusdAmount = amountXlusd !== undefined ? Number(amountXlusd) : null;
    const xrpAmountFromClient = amountXrp !== undefined ? Number(amountXrp) : null;

    const amountToLockXrp = xlusdAmount !== null ? xlusdAmount / XLUSD_PER_XRP : xrpAmountFromClient;

    if (!Number.isFinite(amountToLockXrp) || amountToLockXrp <= 0) {
      return res.status(400).json({ error: "Invalid amountXlusd" });
    }

    // Try to use user's wallet first (including unverified), fallback to server wallet
    let clientWallet;
    try {
      const userWallet = await new Promise((resolve, reject) => {
        getUserWalletAny(userId, (err, wallet) => {
          if (err) reject(err);
          else resolve(wallet);
        });
      });
      clientWallet = userWallet;
    } catch (err) {
      // Fallback to server wallet
      if (!process.env.PAYER_SEED) {
        return res.status(400).json({ 
          error: "No wallet connected. Please connect your XRP wallet first, or server PAYER_SEED must be configured." 
        });
      }
      clientWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    }

    client = await getClient();

    // If requirements exist, use conditional escrow. Otherwise, create simple escrow (no condition)
    let preimage = null;
    let condition = null;
    if (validRequirements.length > 0) {
      // Generate condition/preimage pair for requirements-based escrow
      const pair = generateConditionPair();
      preimage = pair.preimage;
      condition = pair.condition;
    }

    // Create QA escrow (with or without condition based on requirements)
    const result = validRequirements.length > 0
      ? await createQAEscrow({
          client,
          clientWallet,
          providerAddress: providerAddress.trim(),
          amountXrp: amountToLockXrp,
          deadlineUnix: deadline,
          preimage,
        })
      : await createEscrow({
          client,
          payerWallet: clientWallet,
          payeeAddress: providerAddress.trim(),
          amountXrp: amountToLockXrp,
          finishAfterUnix: deadline, // Can finish anytime before deadline
          cancelAfterUnix: deadline + 1, // Can refund after deadline
          condition: null, // No condition - service provider can claim directly
        });

    // createEscrow/createQAEscrow return { result: submitAndWaitResult, offerSequence, ... }
    // submitAndWaitResult has shape: { result: { meta, hash, engine_result, engine_result_message, ... } }
    const submitRes = result.result;
    const txResult = submitRes?.result?.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      return res.status(400).json({
        ok: false,
        txResult,
        engine_result: submitRes?.result?.engine_result,
        engine_result_message: submitRes?.result?.engine_result_message,
        txHash: submitRes?.result?.hash,
        error: submitRes?.result?.engine_result_message || `Transaction failed: ${txResult}`,
      });
    }

    // Store requirements with sequence (preimage stored on server, never shared with client)
    qaEscrowRequirements[result.offerSequence] = {
      requirements: validRequirements,
      preimage, // Stored on server for automatic fulfillment when verified
      condition,
      userId, // Store user ID for security
      ownerAddress: clientWallet.classicAddress,
      providerAddress: providerAddress.trim(),
      verifiedRequirements: {}, // Track which requirements are verified: {index: true}
      allVerified: false, // Flag when all requirements are verified
      proofSubmissions: [], // [{ userId, proofText, proofLinks, createdAt }]
      escrowFinished: false,
      createdAt: new Date().toISOString(),
    };

    return res.json({
      ok: true,
      txHash: submitRes?.result?.hash,
      offerSequence: result.offerSequence,
      txResult,
      amountXlusd: xlusdAmount !== null ? Number(xlusdAmount) : null,
      amountXrpLocked: Number(amountToLockXrp),
      xlusdPerXrp: XLUSD_PER_XRP,
      ownerAddress: clientWallet.classicAddress,
      providerAddress: providerAddress.trim(),
      // Preimage NOT returned to client - stored on server only
      condition, // Only if requirements exist
      deadlineUnix: deadline,
      requirements: validRequirements,
      hasRequirements: validRequirements.length > 0,
      workflow: "quality_assurance",
      instructions: {
        client: validRequirements.length > 0 
          ? "Verify all requirements are met. Once verified, service provider can claim payment directly."
          : "Service provider can claim payment anytime before deadline.",
        provider: validRequirements.length > 0
          ? "Payment is locked with quality requirements. Deliver service meeting all requirements. Once client verifies, you can claim payment directly."
          : "Payment is locked. You can claim payment anytime before the deadline.",
      },
    });
  } catch (err) {
    const statusCode = err.message?.includes("Invalid") || 
                       err.message?.includes("must be") ||
                       err.message?.includes("Cannot")
                       ? 400 : 500;
    
    return res.status(statusCode).json({ 
      error: err.message || String(err),
      ok: false,
    });
  } finally {
    if (client) await client.disconnect();
  }
});

// GET QA ESCROW REQUIREMENTS
app.get("/escrow/qa/requirements/:sequence", requireAuth, (req, res) => {
  const sequence = Number(req.params.sequence);
  const userId = req.session.user.id;

  if (!Number.isFinite(sequence) || sequence <= 0) {
    return res.status(400).json({ error: "Invalid sequence number" });
  }

  const escrowData = qaEscrowRequirements[sequence];
  
  if (!escrowData) {
    return res.status(404).json({ error: "Requirements not found for this escrow sequence" });
  }

  // Security: Only return if user created it (in production, add more checks)
  if (escrowData.userId !== userId) {
    return res.status(403).json({ error: "Not authorized to view this escrow's requirements" });
  }

  return res.json({
    ok: true,
    sequence,
    requirements: escrowData.requirements, // [{ text, evidenceLinks }]
    verifiedRequirements: escrowData.verifiedRequirements || {},
    allVerified: escrowData.allVerified || false,
    aiVerificationStatus: escrowData.aiVerificationStatus || "pending",
    aiSummary: escrowData.aiSummary || null,
    proofCount: escrowData.proofSubmissions?.length || 0,
    escrowFinished: !!escrowData.escrowFinished,
    // Never return preimage - it's stored on server only
  });
});

// SERVICE PROVIDER: submit proof-of-work -> AI verifies -> if all verified, platform finishes escrow and credits provider (auto-convert to XLUSD)
app.post("/escrow/qa/proof/submit", requireAuth, async (req, res) => {
  let client;
  try {
    const { sequence, proofText, proofLinks } = req.body || {};
    const userId = req.session.user.id;

    const seq = Number(sequence);
    if (!Number.isFinite(seq) || seq <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid sequence" });
    }

    const escrowData = qaEscrowRequirements[seq];
    if (!escrowData) {
      return res.status(404).json({ ok: false, error: "Escrow requirements not found for this sequence" });
    }

    // Load provider wallet (must be verified to sign + receive XLUSD)
    const walletRow = await dbPromise.get(
      "SELECT wallet_address, encrypted_seed, is_verified FROM user_wallets WHERE user_id = ? AND is_verified = 1",
      [userId]
    );
    if (!walletRow) {
      return res.status(400).json({ ok: false, error: "No verified wallet found. Please connect and verify your XRPL wallet first." });
    }

    const providerWallet = xrpl.Wallet.fromSeed(decryptSeed(walletRow.encrypted_seed));
    if (providerWallet.classicAddress !== escrowData.providerAddress) {
      return res.status(403).json({ ok: false, error: "Not authorized: your wallet does not match the escrow provider address." });
    }

    const cleanText = String(proofText || "").trim();
    const links = Array.isArray(proofLinks) ? proofLinks.map((u) => String(u || "").trim()).filter((u) => u.length > 0) : [];
    const validLinks = links.filter(isValidUrl);

    if (cleanText.length < 10 && validLinks.length === 0) {
      return res.status(400).json({
        ok: false,
        error: "Please submit proof: add a description (min 10 chars) and/or at least one valid link (photo/PDF).",
      });
    }

    escrowData.proofSubmissions = escrowData.proofSubmissions || [];
    escrowData.proofSubmissions.push({
      userId,
      proofText: cleanText,
      proofLinks: validLinks,
      createdAt: new Date().toISOString(),
    });

    // Run AI verification (proof-aware)
    escrowData.aiVerificationStatus = "in_progress";
    client = await getClient();

    const aiOut = await AIChecker.verifyAllRequirements(escrowData.requirements || [], {
      sequence: seq,
      providerAddress: escrowData.providerAddress,
      proofText: cleanText,
      proofLinks: validLinks,
    });

    escrowData.aiVerificationStatus = "completed";
    escrowData.aiSummary = aiOut.summary;
    escrowData.allVerified = !!aiOut.allVerified;
    escrowData.verifiedRequirements = {};
    (aiOut.results || []).forEach((r, idx) => {
      escrowData.verifiedRequirements[idx] = r;
    });

    // If all verified, platform finishes escrow + converts to XLUSD
    let finish = null;
    let conversion = null;
    if (escrowData.allVerified && !escrowData.escrowFinished) {
      const finishOut = await finishEscrow({
        client,
        payeeWallet: providerWallet,
        ownerAddress: escrowData.ownerAddress,
        offerSequence: seq,
        fulfillment: escrowData.preimage, // server-held preimage unlocks conditional escrow
      });

      finish = {
        ok: finishOut.txResult === "tesSUCCESS",
        txHash: finishOut.hash,
        txResult: finishOut.txResult,
        validated: finishOut.validated,
      };

      if (finish.ok) {
        escrowData.escrowFinished = true;
        const issuer = process.env.XLUSD_ISSUER || DEFAULT_XLUSD_ISSUER;
        conversion = await convertEscrowXrpToXlusd({
          client,
          wallet: providerWallet,
          issuer,
          escrowAmountDrops: finishOut.escrowAmountDrops,
        });
      }
    }

    return res.json({
      ok: true,
      sequence: seq,
      ai: aiOut,
      allVerified: escrowData.allVerified,
      verifiedRequirements: escrowData.verifiedRequirements,
      escrowFinished: escrowData.escrowFinished,
      finish,
      conversion,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  } finally {
    // connection pool keeps client alive
  }
});

// SERVICE PROVIDER: claim payment (only works after AI verified all requirements)
app.post("/escrow/qa/claim", requireAuth, async (req, res) => {
  let client;
  try {
    const { sequence } = req.body || {};
    const userId = req.session.user.id;
    const seq = Number(sequence);
    if (!Number.isFinite(seq) || seq <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid sequence" });
    }

    const escrowData = qaEscrowRequirements[seq];
    if (!escrowData) {
      return res.status(404).json({ ok: false, error: "Escrow requirements not found for this sequence" });
    }

    if (!escrowData.allVerified) {
      return res.status(400).json({ ok: false, error: "Cannot claim: requirements not verified by AI yet." });
    }

    // Must have submitted proof at least once
    if (!escrowData.proofSubmissions || escrowData.proofSubmissions.length === 0) {
      return res.status(400).json({ ok: false, error: "Cannot claim: no proof-of-work submitted yet." });
    }

    // Load provider wallet
    const walletRow = await dbPromise.get(
      "SELECT wallet_address, encrypted_seed, is_verified FROM user_wallets WHERE user_id = ? AND is_verified = 1",
      [userId]
    );
    if (!walletRow) {
      return res.status(400).json({ ok: false, error: "No verified wallet found. Please connect and verify your XRPL wallet first." });
    }

    const providerWallet = xrpl.Wallet.fromSeed(decryptSeed(walletRow.encrypted_seed));
    if (providerWallet.classicAddress !== escrowData.providerAddress) {
      return res.status(403).json({ ok: false, error: "Not authorized: your wallet does not match the escrow provider address." });
    }

    if (escrowData.escrowFinished) {
      return res.json({ ok: true, alreadyFinished: true, sequence: seq });
    }

    client = await getClient();
    const finishOut = await finishEscrow({
      client,
      payeeWallet: providerWallet,
      ownerAddress: escrowData.ownerAddress,
      offerSequence: seq,
      fulfillment: escrowData.preimage,
    });

    const finishOk = finishOut.txResult === "tesSUCCESS";
    let conversion = null;
    if (finishOk) {
      escrowData.escrowFinished = true;
      const issuer = process.env.XLUSD_ISSUER || DEFAULT_XLUSD_ISSUER;
      conversion = await convertEscrowXrpToXlusd({
        client,
        wallet: providerWallet,
        issuer,
        escrowAmountDrops: finishOut.escrowAmountDrops,
      });
    }

    return res.status(finishOk ? 200 : 400).json({
      ok: finishOk,
      sequence: seq,
      txHash: finishOut.hash,
      txResult: finishOut.txResult,
      validated: finishOut.validated,
      conversion,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  } finally {
    // connection pool keeps client alive
  }
});

// Note: Release happens when freelancer uses /escrow/finish with the preimage
// This endpoint just validates and formats the release instruction

/* ======================
   XLUSD BALANCE & BUY
====================== */

// GET XLUSD BALANCE
app.get("/api/xlusd/balance", requireAuth, async (req, res) => {
  let client;
  try {
    const userId = req.session.user?.id;
    const accountAddress = req.query.address;
    
    // Calculate simulated balance from database (completed purchases - completed withdrawals)
    // Parallelize queries for better performance
    const [purchaseRow, withdrawalRow] = await Promise.all([
      dbPromise.get(
        `SELECT COALESCE(SUM(amount_xlusd), 0) as total_purchases 
         FROM payments 
         WHERE user_id = ? AND status = ?`,
        [userId, PAYMENT_STATUS.COMPLETED]
      ),
      dbPromise.get(
        `SELECT COALESCE(SUM(amount_xlusd), 0) as total_withdrawals 
         FROM withdrawals 
         WHERE user_id = ? AND status IN (?, ?)`,
        [userId, WITHDRAWAL_STATUS.COMPLETED, WITHDRAWAL_STATUS.PROCESSING]
      ),
    ]);
    
    const purchases = purchaseRow?.total_purchases || 0;
    const withdrawals = withdrawalRow?.total_withdrawals || 0;
    const simulatedBalance = Math.max(0, purchases - withdrawals);
    
    // Try to get real XRPL balance if address is provided or user has wallet
    let xrplBalance = 0;
    let address = accountAddress;
    
    // If no address provided, try to get user's wallet address
    if (!address) {
      const userWalletData = await dbPromise.get(
        "SELECT wallet_address FROM user_wallets WHERE user_id = ? AND is_verified = 1",
        [userId]
      );
      
      if (userWalletData) {
        address = userWalletData.wallet_address;
      } else if (process.env.PAYER_SEED) {
        // Fallback to server wallet
        const wallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
        address = wallet.classicAddress;
      }
    }
    
    // Get XRPL balance if we have an address
    if (address) {
      try {
        client = await getClient();
        
        const accountLines = await client.request({
          command: "account_lines",
          account: address,
          ledger_index: "validated",
        });

        const xlusdIssuer = process.env.XLUSD_ISSUER || DEFAULT_XLUSD_ISSUER;

        const xlusdLine = accountLines.result.lines?.find(
          (line) =>
            line.currency === XLUSD_CURRENCY &&
            line.account === xlusdIssuer
        );

        xrplBalance = xlusdLine ? parseFloat(xlusdLine.balance) : 0;
      } catch (xrplErr) {
        console.warn("Failed to get XRPL balance, using simulated balance only:", xrplErr.message);
        // Continue with simulated balance only
      }
    }
    
    // Total balance = XRPL balance + simulated balance
    // In simulate mode, XRPL balance will be 0, so total = simulated
    const totalBalance = xrplBalance + simulatedBalance;

    return res.json({
      ok: true,
      balance: totalBalance,
      xrplBalance: xrplBalance,
      simulatedBalance: simulatedBalance,
      currency: XLUSD_CURRENCY,
      issuer: process.env.XLUSD_ISSUER || DEFAULT_XLUSD_ISSUER,
      account: address || null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
  // Note: Client connection is reused via connection pool, no need to disconnect
});

// PURCHASE XLUSD (Process payment via credit card or PayNow)
app.post("/api/xlusd/purchase", requireAuth, async (req, res) => {
  let client;
  try {
    const { amountXlusd, paymentMethod, cardDetails, paynowRef } = req.body || {};
    const userId = req.session.user?.id;

    if (!isValidAmount(amountXlusd)) {
      return res.status(400).json({ error: "Invalid amountXlusd" });
    }

    if (!isValidPaymentMethod(paymentMethod)) {
      return res.status(400).json({ error: "Invalid payment method" });
    }

    // Check if we're in test/fake payment mode
    const testMode = process.env.TEST_MODE === "true" || process.env.FAKE_PAYMENTS === "true" || !process.env.STRIPE_SECRET_KEY;
    // Simulate XLUSD if explicitly enabled, or if in test mode, or if PAYER_SEED is not set
    const simulateXlusd = process.env.SIMULATE_XLUSD === "true" || 
                          testMode || 
                          (!process.env.XLUSD_ISSUER_SEED && !process.env.PAYER_SEED);

    // Get user's verified wallet from database (optional in simulate mode)
    const userWalletData = await new Promise((resolve, reject) => {
      db.get(
        "SELECT wallet_address, encrypted_seed, is_verified FROM user_wallets WHERE user_id = ? AND is_verified = 1",
        [userId],
        (err, row) => {
          if (err) reject(err);
          else resolve(row);
        }
      );
    });

    let userWallet = null;
    let recipientAddress = null;

    // In simulate mode, wallet is optional
    if (!userWalletData && !simulateXlusd) {
      return res.status(400).json({ 
        error: "No verified wallet found. Please connect and verify your XRPL wallet first." 
      });
    }

    // If wallet exists, decrypt and load it
    if (userWalletData) {
      try {
        const seed = decryptSeed(userWalletData.encrypted_seed);
        userWallet = xrpl.Wallet.fromSeed(seed);
        recipientAddress = userWallet.classicAddress;
      } catch (decryptErr) {
        if (!simulateXlusd) {
          return res.status(500).json({ error: "Failed to load user wallet: " + decryptErr.message });
        }
        // In simulate mode, continue without wallet
        console.warn("Failed to load wallet, but continuing in simulate mode:", decryptErr.message);
      }
    }

    const amountUsd = Number(amountXlusd) * 1.0; // $1 per XLUSD
    let paymentId;
    let paymentStatus = "pending";
    let paymentRecordId;

    // Record payment in database
    const paymentResult = await dbPromise.run(
      `INSERT INTO payments (user_id, amount_xlusd, amount_usd, payment_method, status) 
       VALUES (?, ?, ?, ?, ?)`,
      [userId, amountXlusd, amountUsd, paymentMethod, PAYMENT_STATUS.PENDING]
    );
    paymentRecordId = paymentResult.lastID;

    if (paymentMethod === "creditcard") {
      // Card details are optional if:
      // 1. Test mode is enabled, OR
      // 2. Stripe is not configured, OR
      // 3. Card details are not provided (will use fake payment)
      const hasStripe = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.trim() !== "";
      const cardDetailsRequired = hasStripe && !testMode;
      
      if (cardDetailsRequired && !cardDetails) {
        return res.status(400).json({ 
          error: "Card details required when Stripe is configured. " +
                 "Set TEST_MODE=true or remove STRIPE_SECRET_KEY to use test mode." 
        });
      }
      
      // If no card details and we're in test mode, that's fine - will use fake payment
      console.log(`Card payment: testMode=${testMode}, hasStripe=${hasStripe}, hasCardDetails=${!!cardDetails}`);

      // Stripe integration (if STRIPE_SECRET_KEY is set and not in test mode)
      if (hasStripe && !testMode) {
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
          paymentStatus = paymentIntent.status === "succeeded" ? PAYMENT_STATUS.COMPLETED : PAYMENT_STATUS.PENDING;
          
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
          console.log("⚠️  Stripe error occurred. Using simulated payment.");
          paymentId = `cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          paymentStatus = PAYMENT_STATUS.COMPLETED;
        }
      } else {
        // Simulated payment for development/test mode
        console.log("💰 TEST MODE: Using fake payment (no real money charged)");
        paymentId = `cc_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        paymentStatus = PAYMENT_STATUS.COMPLETED;
      }
      
    } else if (paymentMethod === "paynow") {
      // In test mode, paynowRef is optional
      if (!testMode && !paynowRef) {
        return res.status(400).json({ error: "PayNow reference required" });
      }
      
      // PayNow integration would go here
      // In test mode, simulate payment
      if (testMode) {
        console.log("💰 TEST MODE: Using fake PayNow payment (no real money charged)");
        paymentId = `pn_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      } else {
        paymentId = `pn_${paynowRef || Date.now()}`;
      }
      paymentStatus = PAYMENT_STATUS.COMPLETED;
      
      // TODO: Verify PayNow payment via API
      // In production, you'd verify the payment with PayNow gateway
    }

    if (paymentStatus !== PAYMENT_STATUS.COMPLETED) {
      // Update payment status to failed
      if (paymentRecordId) {
        await dbPromise.run(
          `UPDATE payments SET status = ?, payment_id = ? WHERE id = ?`,
          [PAYMENT_STATUS.FAILED, paymentId || null, paymentRecordId]
        );
      }
      return res.status(400).json({ error: "Payment processing failed" });
    }

    // Fake bank: collect USD when payment succeeds
    await recordBankTransaction({
      userId,
      direction: "in",
      amountUsd,
      reference: paymentId || `payment_${paymentRecordId}`,
      metadata: {
        type: "xlusd_purchase",
        paymentMethod,
        amountXlusd: Number(amountXlusd),
        paymentRecordId,
        simulated: simulateXlusd,
        testMode,
      },
    });

    // After payment is confirmed, mint/transfer XLUSD to user's account
    // In simulate mode, just record in database without XRPL transaction
    if (simulateXlusd) {
      console.log("💰 SIMULATE MODE: Recording XLUSD purchase in database (no XRPL transaction)");
      console.log(`   Amount: ${amountXlusd} XLUSD, User: ${userId}, Wallet: ${recipientAddress || 'none (simulated)'}`);
      
      // Update payment record with success
      if (paymentRecordId) {
        await dbPromise.run(
          `UPDATE payments SET status = ?, payment_id = ? WHERE id = ?`,
          [PAYMENT_STATUS.COMPLETED, paymentId, paymentRecordId]
        );
        console.log(`✅ Payment ${paymentRecordId} marked as completed`);
      }
      
      // Update simulated XRP balance (add XLUSD amount as XRP for testing)
      // In real scenario, buying XLUSD doesn't give XRP, but for testing we'll simulate this
      if (userWalletData) {
        try {
          await dbPromise.run(
            `UPDATE user_wallets 
             SET simulated_balance_xrp = COALESCE(simulated_balance_xrp, 0) + ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?`,
            [Number(amountXlusd), userId]
          );
          console.log(`✅ Updated simulated XRP balance: +${amountXlusd} XRP`);
        } catch (err) {
          console.error("Failed to update simulated XRP balance:", err);
          // Continue - this is optional
        }
      } else {
        // If no wallet, create a simulated balance entry
        // We can't update user_wallets without a wallet, so we'll skip this
        console.log("⚠️  No wallet connected - cannot update simulated XRP balance");
      }
      
      return res.json({
        ok: true,
        txHash: `simulated_${Date.now()}`,
        txResult: "tesSUCCESS",
        amountXlusd: Number(amountXlusd),
        paymentId,
        paymentMethod,
        simulated: true,
        message: "XLUSD purchase recorded (simulated mode - no XRPL transaction)",
      });
    }
    
    // Real XRPL mode requires wallet
    if (!userWallet || !recipientAddress) {
      return res.status(400).json({ 
        error: "Wallet required for real XRPL transactions. Set SIMULATE_XLUSD=true to use test mode." 
      });
    }
    
    // Real XRPL transaction mode
    client = await getClient();
    
    const xlusdIssuer = process.env.XLUSD_ISSUER || DEFAULT_XLUSD_ISSUER;
    
    // Get issuer wallet - issuer must be configured
    if (!process.env.XLUSD_ISSUER_SEED && !process.env.PAYER_SEED) {
      return res.status(500).json({ 
        error: "Missing XLUSD_ISSUER_SEED or PAYER_SEED. Cannot mint XLUSD. " +
               "Set SIMULATE_XLUSD=true in .env to use test mode without XRPL transactions." 
      });
    }
    
    let issuerWallet;
    try {
      issuerWallet = xrpl.Wallet.fromSeed(process.env.XLUSD_ISSUER_SEED || process.env.PAYER_SEED);
    } catch (seedErr) {
      return res.status(500).json({ 
        error: `Invalid issuer seed: ${seedErr.message}. ` +
               "Set SIMULATE_XLUSD=true in .env to use test mode without XRPL transactions." 
      });
    }
    
    // Verify issuer wallet matches configured issuer address (if both are set)
    if (process.env.XLUSD_ISSUER_SEED && issuerWallet.classicAddress !== xlusdIssuer) {
      console.warn(`⚠️  Warning: Issuer wallet address (${issuerWallet.classicAddress}) doesn't match XLUSD_ISSUER (${xlusdIssuer})`);
      // Still proceed - might be intentional for testing
    }

    // Check if user's account has trustline, if not, create it first
    const accountLines = await client.request({
      command: "account_lines",
      account: recipientAddress,
      ledger_index: "validated",
    });

    const hasTrustline = accountLines.result.lines?.some(
      (line) => line.currency === xlusdCurrency && line.account === xlusdIssuer
    );

    if (!hasTrustline) {
      // Create trustline using user's wallet (required for receiving XLUSD)
      const trustlineTx = {
        TransactionType: "TrustSet",
        Account: recipientAddress,
        LimitAmount: {
          currency: XLUSD_CURRENCY,
          issuer: xlusdIssuer,
          value: "1000000", // Set a high limit
        },
      };

      const preparedTrustline = await client.autofill(trustlineTx);
      const signedTrustline = userWallet.sign(preparedTrustline);
      const trustlineResult = await client.submitAndWait(signedTrustline.tx_blob);
      
      const trustlineTxResult = trustlineResult.result?.meta?.TransactionResult;
      if (trustlineTxResult !== "tesSUCCESS") {
        const errorMsg = trustlineResult.result?.engine_result_message || `Transaction failed: ${trustlineTxResult}`;
        console.error("Trustline creation failed:", {
          txResult: trustlineTxResult,
          engine_result: trustlineResult.result?.engine_result,
          engine_result_message: errorMsg,
          account: recipientAddress,
        });
        
        return res.status(400).json({
          ok: false,
          error: `Failed to create trustline for XLUSD: ${errorMsg}`,
          txResult: trustlineTxResult,
          engine_result: trustlineResult.result?.engine_result,
          engine_result_message: errorMsg,
          hint: "Make sure your wallet has enough XRP for the trustline transaction fee (usually ~12 XRP reserve + fee). " +
                "Set SIMULATE_XLUSD=true in .env to use test mode without XRPL transactions.",
        });
      }
    }

    // Send XLUSD payment from issuer to user's account
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
      const errorMsg = result.result?.engine_result_message || `Transaction failed: ${txResult}`;
      console.error("XLUSD transfer failed:", {
        txResult,
        engine_result: result.result?.engine_result,
        engine_result_message: errorMsg,
        issuer: issuerWallet.classicAddress,
        recipient: recipientAddress,
        amount: amountXlusd,
      });
      
      return res.status(400).json({
        ok: false,
        error: `Failed to transfer XLUSD: ${errorMsg}`,
        txResult,
        engine_result: result.result?.engine_result,
        engine_result_message: errorMsg,
        txHash: result.result?.hash,
        hint: "Make sure the issuer wallet has XLUSD to send and enough XRP for fees. " +
              "Set SIMULATE_XLUSD=true in .env to use test mode without XRPL transactions.",
      });
    }

    // Update payment record with success
    if (paymentRecordId) {
      await dbPromise.run(
        `UPDATE payments SET status = ?, payment_id = ?, tx_hash = ? WHERE id = ?`,
        [PAYMENT_STATUS.COMPLETED, paymentId, result.result?.hash, paymentRecordId]
      );
    }

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
  }
  // Note: Client connection is reused via connection pool, no need to disconnect
});

// WITHDRAW XLUSD (Convert XLUSD back to fiat)
app.post("/api/xlusd/withdraw", requireAuth, async (req, res) => {
  try {
    const { amountXlusd, withdrawalMethod, accountDetails } = req.body || {};
    const userId = req.session.user?.id;

    if (!isValidAmount(amountXlusd)) {
      return res.status(400).json({ error: "Invalid amountXlusd" });
    }

    if (!isValidWithdrawalMethod(withdrawalMethod)) {
      return res.status(400).json({ error: "Invalid withdrawal method" });
    }

    // Fake bank mode: withdrawals are off-ledger and use simulated XLUSD balance from DB.
    const amtXlusd = Number(amountXlusd);
    const [purchaseRow, withdrawalRow] = await Promise.all([
      dbPromise.get(
        `SELECT COALESCE(SUM(amount_xlusd), 0) as total_purchases 
         FROM payments 
         WHERE user_id = ? AND status = ?`,
        [userId, PAYMENT_STATUS.COMPLETED]
      ),
      dbPromise.get(
        `SELECT COALESCE(SUM(amount_xlusd), 0) as total_withdrawals 
         FROM withdrawals 
         WHERE user_id = ? AND status IN (?, ?)`,
        [userId, WITHDRAWAL_STATUS.COMPLETED, WITHDRAWAL_STATUS.PROCESSING]
      ),
    ]);

    const currentBalance = Math.max(
      0,
      Number(purchaseRow?.total_purchases || 0) - Number(withdrawalRow?.total_withdrawals || 0)
    );

    if (currentBalance < amtXlusd) {
      return res.status(400).json({
        error: `Insufficient balance. You have ${currentBalance.toFixed(2)} XLUSD`,
      });
    }

    const amountUsd = Number(amountXlusd) * XLUSD_PRICE_USD;

    // Record withdrawal in database
    const insert = await dbPromise.run(
      `INSERT INTO withdrawals (user_id, amount_xlusd, amount_usd, withdrawal_method, account_details, status) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [userId, amtXlusd, amountUsd, withdrawalMethod, JSON.stringify(accountDetails || {}), WITHDRAWAL_STATUS.COMPLETED]
    );

    const withdrawalId = `wd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Fake bank: payout USD to user
    await recordBankTransaction({
      userId,
      direction: "out",
      amountUsd,
      reference: withdrawalId,
      metadata: {
        type: "xlusd_withdrawal",
        withdrawalMethod,
        withdrawalRowId: insert.lastID,
        accountDetails: accountDetails || {},
        amountXlusd: amtXlusd,
      },
    });

    return res.json({
      ok: true,
      txHash: null,
      txResult: "tesSUCCESS",
      amountXlusd: amtXlusd,
      amountUsd,
      withdrawalId,
      withdrawalMethod,
      status: WITHDRAWAL_STATUS.COMPLETED,
      message: "Withdrawal completed (fake bank). USD payout recorded.",
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
  // Note: No XRPL interaction needed for fake bank withdrawals
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
      ? parseFloat(dropsToXrp(takerPays))
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
      // Round total XRP needed to 5 decimals before converting to drops
      TakerPays: xrpToDrops(Number(totalXrpNeeded).toFixed(5)),
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
  }
  // Note: Client connection is reused via connection pool, no need to disconnect
});

/* ======================
   HISTORY & STATS
====================== */

// GET TRANSACTION HISTORY
app.get("/api/history", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id;
    const limit = parseInt(req.query.limit) || 50;
    
    // Get payments and withdrawals from database in parallel
    const [paymentRows, withdrawalRows] = await Promise.all([
      dbPromise.all(
        `SELECT 
          id, 
          amount_xlusd, 
          amount_usd, 
          payment_method as method,
          payment_id,
          status,
          tx_hash,
          created_at,
          'purchase' as type
         FROM payments 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`,
        [userId, limit]
      ),
      dbPromise.all(
        `SELECT 
          id, 
          amount_xlusd, 
          amount_usd, 
          withdrawal_method as method,
          status,
          tx_hash,
          created_at,
          'withdrawal' as type
         FROM withdrawals 
         WHERE user_id = ? 
         ORDER BY created_at DESC 
         LIMIT ?`,
        [userId, limit]
      ),
    ]);
    
    // Combine and sort by date
    const all = [
      ...paymentRows.map(row => ({
        id: row.id,
        type: 'purchase',
        amount: row.amount_xlusd,
        amountUsd: row.amount_usd,
        method: row.method,
        status: row.status || PAYMENT_STATUS.PENDING,
        txHash: row.tx_hash,
        paymentId: row.payment_id,
        timestamp: new Date(row.created_at).getTime() / 1000,
        date: row.created_at,
      })),
      ...withdrawalRows.map(row => ({
        id: row.id,
        type: 'withdrawal',
        amount: row.amount_xlusd,
        amountUsd: row.amount_usd,
        method: row.method,
        status: row.status || WITHDRAWAL_STATUS.PENDING,
        txHash: row.tx_hash,
        timestamp: new Date(row.created_at).getTime() / 1000,
        date: row.created_at,
      }))
    ];
    
    // Sort by timestamp descending
    all.sort((a, b) => b.timestamp - a.timestamp);
    
    console.log(`History for user ${userId}: ${paymentRows.length} payments, ${withdrawalRows.length} withdrawals`);
    
    const history = all.slice(0, limit);

    return res.json({
      ok: true,
      history,
      total: history.length,
    });
  } catch (err) {
    console.error("History error:", err);
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

// Fake bank USD balance (for deposits/payouts)
app.get("/api/bank/balance", requireAuth, async (req, res) => {
  try {
    const userId = req.session.user?.id;
    const balanceUsd = await getBankBalanceUsd(userId);
    return res.json({ ok: true, balanceUsd });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message || String(err) });
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

      const xrpBalance = dropsToXrp(accountInfo.result.account_data.Balance);

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
            ? parseFloat(dropsToXrp(offer.TakerPays))
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
  }
  // Note: Client connection is reused via connection pool, no need to disconnect
});

/* ======================
   START
====================== */

const PORT = Number(process.env.PORT || 3001);
const server = app.listen(PORT, () => {
  console.log(`🚀 Backend running at http://localhost:${PORT}`);
  console.log(`📊 Test wallet: http://localhost:${PORT}/api/test/wallet`);
});

server.on("error", (err) => {
  if (err?.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use.`);
    console.error(`   Tip: stop the existing process, or run with PORT=${PORT + 1} npm start`);
    process.exit(1);
  }
  throw err;
});
