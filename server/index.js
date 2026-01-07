import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import xrpl from "xrpl";
import session from "express-session";
import bcrypt from "bcrypt";
import crypto from "crypto";

import db from "./db.js";
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
} from "./xrpl.js";
import AIChecker from "./ai-checker.js";

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

// CORS for Live Server, development, and live demos (ngrok, localtunnel, etc.)
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps, Postman, or file://)
      if (!origin) return callback(null, true);
      
      // In development, allow common localhost ports and Live Server ports
      const allowedOrigins = [
        "http://127.0.0.1:5500",
        "http://127.0.0.1:5501",
        "http://127.0.0.1:5502",
        "http://127.0.0.1:5503",
        "http://127.0.0.1:8080",
        "http://127.0.0.1:3000",
        "http://localhost:5500",
        "http://localhost:5501",
        "http://localhost:5502",
        "http://localhost:5503",
        "http://localhost:8080",
        "http://localhost:3000",
      ];
      
      // In development/demo, allow:
      // - localhost origins
      // - ngrok domains (for live demos)
      // - localtunnel domains (for live demos)
      // - Cloudflare tunnel domains
      if (process.env.NODE_ENV !== "production") {
        if (
          origin.includes("localhost") || 
          origin.includes("127.0.0.1") ||
          origin.includes(".ngrok-free.app") ||
          origin.includes(".ngrok.io") ||
          origin.includes(".loca.lt") ||
          origin.includes(".trycloudflare.com") ||
          origin.match(/^https?:\/\/[0-9a-f-]+\.loca\.lt$/) // localtunnel pattern
        ) {
          return callback(null, true);
        }
      }
      
      if (allowedOrigins.indexOf(origin) !== -1 || !origin) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
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

function validateXRPLSeed(seed) {
  if (!seed || typeof seed !== "string") return false;
  const trimmed = seed.trim();
  // XRPL seeds start with 's' (family seed) or 'sEd' (Ed25519)
  // Length can vary, so we'll be more flexible and let xrpl.Wallet.fromSeed validate
  if (!trimmed.startsWith("s")) return false;
  // Basic length check (seeds are typically 29-31 characters)
  if (trimmed.length < 25 || trimmed.length > 35) return false;
  // Allow base58 characters (excluding 0, O, I, l to avoid confusion)
  return /^s[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
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
  
  // Get wallet info if connected
  db.get(
    "SELECT wallet_address, is_verified FROM user_wallets WHERE user_id = ?",
    [req.session.user.id],
    (err, wallet) => {
      if (err) {
        console.error("Error fetching wallet:", err);
        return res.json({ ok: true, user: req.session.user, wallet: null });
      }
      
      return res.json({
        ok: true,
        user: req.session.user,
        wallet: wallet ? {
          address: wallet.wallet_address,
          isVerified: !!wallet.is_verified,
        } : null,
      });
    }
  );
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
    let trimmedSeed = String(seed).trim().replace(/\s+/g, "");
    
    // Remove any invisible/hidden characters (zero-width spaces, etc.)
    trimmedSeed = trimmedSeed.replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "");
    
    // Remove any non-printable characters
    trimmedSeed = trimmedSeed.replace(/[\x00-\x1F\x7F-\x9F]/g, "");

    // Basic format check
    if (!trimmedSeed || trimmedSeed.length < 20) {
      return res.status(400).json({ 
        error: "Invalid wallet seed format. XRPL seeds must start with 's' and be at least 20 characters long. Make sure you're copying the seed (secret), not the address." 
      });
    }

    if (!trimmedSeed.startsWith("s")) {
      return res.status(400).json({ 
        error: "Invalid wallet seed format. XRPL seeds must start with 's'. Make sure you're copying the SEED (secret starting with 's'), not the wallet address (starting with 'r')." 
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
            const balanceXrp = parseFloat(xrpl.dropsToXrp(balanceDrops));
            
            // Verify seed matches address (sanity check)
            try {
              const seed = decryptSeed(wallet.encrypted_seed);
              const userWallet = xrpl.Wallet.fromSeed(seed);
              
              if (userWallet.classicAddress !== wallet.wallet_address) {
                if (client) await client.disconnect();
                return res.status(400).json({ 
                  ok: false,
                  error: "Wallet seed doesn't match stored address. Please reconnect your wallet." 
                });
              }
            } catch (decryptErr) {
              console.error("Decrypt error during verify:", decryptErr);
              if (client) await client.disconnect();
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
                  if (client) await client.disconnect();
                  return res.status(500).json({ ok: false, error: "Failed to update verification status" });
                }
                if (client) await client.disconnect();
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
          if (client) await client.disconnect();
          // Make sure to send error response after disconnecting
          return res.status(400).json({ 
            ok: false,
            error: "Verification failed: " + (verifyErr.message || verifyErr.toString()),
            details: verifyErr.data?.error || "Unknown error"
          });
        }
      }
    );
  } catch (err) {
    if (client) await client.disconnect();
    return res.status(500).json({ error: err.message || "Server error" });
  }
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
          const balanceXrp = parseFloat(xrpl.dropsToXrp(balanceDrops));
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
    if (client) await client.disconnect();
    return res.status(500).json({ error: err.message || "Server error" });
  }
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
    const { payeeAddress, amountXrp, finishAfterUnix, cancelAfterUnix, condition } =
      req.body || {};
    const userId = req.session.user.id;

    // Basic validation - detailed validation happens in createEscrow
    if (!payeeAddress || typeof payeeAddress !== "string") {
      return res.status(400).json({ error: "Missing or invalid payeeAddress" });
    }

    if (!amountXrp) {
      return res.status(400).json({ error: "Missing amountXrp" });
    }

    if (!finishAfterUnix) {
      return res.status(400).json({ error: "Missing finishAfterUnix" });
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
      amountXrp,
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
      amountXrp: Number(amountXrp),
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
    const userId = req.session.user?.id;
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

// CREATE QA ESCROW (with requirements checklist)
app.post("/escrow/qa/create", requireAuth, async (req, res) => {
  let client;
  try {
    const { providerAddress, amountXrp, deadlineUnix, requirements } = req.body || {};
    const userId = req.session.user.id;

    // Basic validation
    if (!providerAddress || typeof providerAddress !== "string") {
      return res.status(400).json({ error: "Missing or invalid providerAddress" });
    }

    if (!amountXrp) {
      return res.status(400).json({ error: "Missing amountXrp" });
    }

    if (!deadlineUnix) {
      return res.status(400).json({ error: "Missing deadlineUnix" });
    }

    // Requirements are optional - if provided, must be valid
    const validRequirements = [];
    if (requirements && Array.isArray(requirements)) {
      const filtered = requirements.filter(req => req && typeof req === "string" && req.trim().length > 0);
      if (filtered.length > 0) {
        validRequirements.push(...filtered);
      }
    }

    const deadline = Number(deadlineUnix);
    const nowUnix = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(deadline) || deadline <= nowUnix) {
      return res.status(400).json({ 
        error: "deadlineUnix must be a future timestamp" 
      });
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
          amountXrp,
          deadlineUnix: deadline,
          preimage,
        })
      : await createEscrow({
          client,
          payerWallet: clientWallet,
          payeeAddress: providerAddress.trim(),
          amountXrp,
          finishAfterUnix: deadline, // Can finish anytime before deadline
          cancelAfterUnix: deadline + 1, // Can refund after deadline
          condition: null, // No condition - service provider can claim directly
        });

    const txResult = result.result.result?.meta?.TransactionResult;

    if (txResult !== "tesSUCCESS") {
      return res.status(400).json({
        ok: false,
        txResult,
        engine_result: result.result.result?.engine_result,
        engine_result_message: result.result.result?.engine_result_message,
        txHash: result.result.result?.hash,
        error: result.result.result?.engine_result_message || `Transaction failed: ${txResult}`,
      });
    }

    // Store requirements with sequence (preimage stored on server, never shared with client)
    qaEscrowRequirements[result.offerSequence] = {
      requirements: validRequirements,
      preimage, // Stored on server for automatic fulfillment when verified
      condition,
      userId, // Store user ID for security
      providerAddress: providerAddress.trim(),
      verifiedRequirements: {}, // Track which requirements are verified: {index: true}
      allVerified: false, // Flag when all requirements are verified
      createdAt: new Date().toISOString(),
    };

    return res.json({
      ok: true,
      txHash: result.result.result?.hash,
      offerSequence: result.offerSequence,
      txResult,
      amountXrp: Number(amountXrp),
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
    requirements: escrowData.requirements,
    verifiedRequirements: escrowData.verifiedRequirements || {},
    allVerified: escrowData.allVerified || false,
    aiVerificationStatus: escrowData.aiVerificationStatus || "pending",
    aiSummary: escrowData.aiSummary || null,
    // Never return preimage - it's stored on server only
  });
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
    const simulatedBalance = await new Promise((resolve, reject) => {
      // Get sum of completed purchases
      db.get(
        `SELECT COALESCE(SUM(amount_xlusd), 0) as total_purchases 
         FROM payments 
         WHERE user_id = ? AND status = 'completed'`,
        [userId],
        (err, purchaseRow) => {
          if (err) {
            reject(err);
            return;
          }
          
          // Get sum of completed withdrawals
          db.get(
            `SELECT COALESCE(SUM(amount_xlusd), 0) as total_withdrawals 
             FROM withdrawals 
             WHERE user_id = ? AND status IN ('completed', 'processing')`,
            [userId],
            (err2, withdrawalRow) => {
              if (err2) {
                reject(err2);
                return;
              }
              
              const purchases = purchaseRow?.total_purchases || 0;
              const withdrawals = withdrawalRow?.total_withdrawals || 0;
              const simulated = Math.max(0, purchases - withdrawals);
              resolve(simulated);
            }
          );
        }
      );
    });
    
    // Try to get real XRPL balance if address is provided or user has wallet
    let xrplBalance = 0;
    let address = accountAddress;
    
    // If no address provided, try to get user's wallet address
    if (!address) {
      const userWalletData = await new Promise((resolve, reject) => {
        db.get(
          "SELECT wallet_address FROM user_wallets WHERE user_id = ? AND is_verified = 1",
          [userId],
          (err, row) => {
            if (err) reject(err);
            else resolve(row);
          }
        );
      });
      
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

        const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
        const xlusdCurrency = "XLUSD";

        const xlusdLine = accountLines.result.lines?.find(
          (line) =>
            line.currency === xlusdCurrency &&
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
    
    const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
    const xlusdCurrency = "XLUSD";

    return res.json({
      ok: true,
      balance: totalBalance,
      xrplBalance: xrplBalance,
      simulatedBalance: simulatedBalance,
      currency: xlusdCurrency,
      issuer: xlusdIssuer,
      account: address || null,
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
    await new Promise((resolve, reject) => {
      db.run(
        `INSERT INTO payments (user_id, amount_xlusd, amount_usd, payment_method, status) 
         VALUES (?, ?, ?, ?, ?)`,
        [userId, amountXlusd, amountUsd, paymentMethod, "pending"],
        function (err) {
          if (err) {
            console.error("Failed to record payment:", err);
            reject(err);
          } else {
            paymentRecordId = this.lastID;
            resolve();
          }
        }
      );
    });

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
      if (process.env.STRIPE_SECRET_KEY && !testMode) {
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
          console.log("⚠️  Stripe error occurred. Using simulated payment.");
          paymentId = `cc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          paymentStatus = "completed";
        }
      } else {
        // Simulated payment for development/test mode
        console.log("💰 TEST MODE: Using fake payment (no real money charged)");
        paymentId = `cc_test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        paymentStatus = "completed";
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
      paymentStatus = "completed";
      
      // TODO: Verify PayNow payment via API
      // In production, you'd verify the payment with PayNow gateway
    }

    if (paymentStatus !== "completed") {
      // Update payment status to failed
      if (paymentRecordId) {
        db.run(
          `UPDATE payments SET status = 'failed', payment_id = ? WHERE id = ?`,
          [paymentId || null, paymentRecordId]
        );
      }
      return res.status(400).json({ error: "Payment processing failed" });
    }

    // After payment is confirmed, mint/transfer XLUSD to user's account
    // In simulate mode, just record in database without XRPL transaction
    if (simulateXlusd) {
      console.log("💰 SIMULATE MODE: Recording XLUSD purchase in database (no XRPL transaction)");
      console.log(`   Amount: ${amountXlusd} XLUSD, User: ${userId}, Wallet: ${recipientAddress || 'none (simulated)'}`);
      
      // Update payment record with success - await to ensure it completes
      if (paymentRecordId) {
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE payments SET status = 'completed', payment_id = ? WHERE id = ?`,
            [paymentId, paymentRecordId],
            function(err) {
              if (err) {
                console.error("Failed to update payment status:", err);
                reject(err);
              } else {
                console.log(`✅ Payment ${paymentRecordId} marked as completed`);
                resolve();
              }
            }
          );
        });
      }
      
      // Update simulated XRP balance (add XLUSD amount as XRP for testing)
      // In real scenario, buying XLUSD doesn't give XRP, but for testing we'll simulate this
      if (userWalletData) {
        await new Promise((resolve, reject) => {
          db.run(
            `UPDATE user_wallets 
             SET simulated_balance_xrp = COALESCE(simulated_balance_xrp, 0) + ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?`,
            [Number(amountXlusd), userId],
            function(err) {
              if (err) {
                console.error("Failed to update simulated XRP balance:", err);
                // Don't reject - this is optional
              } else {
                console.log(`✅ Updated simulated XRP balance: +${amountXlusd} XRP`);
              }
              resolve(); // Always resolve - this is optional
            }
          );
        });
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
    
    const xlusdIssuer = process.env.XLUSD_ISSUER || "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
    const xlusdCurrency = "XLUSD";
    
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
          currency: xlusdCurrency,
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
      db.run(
        `UPDATE payments SET status = 'completed', payment_id = ?, tx_hash = ? WHERE id = ?`,
        [paymentId, result.result?.hash, paymentRecordId]
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
    const userId = req.session.user?.id;
    const limit = parseInt(req.query.limit) || 50;
    
    // Get payments and withdrawals from database
    const history = await new Promise((resolve, reject) => {
      // Get payments
      db.all(
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
        [userId, limit],
        (err, paymentRows) => {
          if (err) {
            reject(err);
            return;
          }
          
          // Get withdrawals
          db.all(
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
            [userId, limit],
            (err2, withdrawalRows) => {
              if (err2) {
                reject(err2);
                return;
              }
              
              // Combine and sort by date
              const all = [
                ...paymentRows.map(row => ({
                  id: row.id,
                  type: 'purchase',
                  amount: row.amount_xlusd,
                  amountUsd: row.amount_usd,
                  method: row.method,
                  status: row.status || 'pending',
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
                  status: row.status || 'pending',
                  txHash: row.tx_hash,
                  timestamp: new Date(row.created_at).getTime() / 1000,
                  date: row.created_at,
                }))
              ];
              
              // Sort by timestamp descending
              all.sort((a, b) => b.timestamp - a.timestamp);
              
              console.log(`History for user ${userId}: ${paymentRows.length} payments, ${withdrawalRows.length} withdrawals`);
              console.log(`Payment statuses:`, paymentRows.map(r => ({ id: r.id, status: r.status, amount: r.amount_xlusd })));
              
              resolve(all.slice(0, limit));
            }
          );
        }
      );
    });

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
