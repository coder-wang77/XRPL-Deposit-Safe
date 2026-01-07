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

// CORS for Live Server and development
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
      
      // In development, also allow any localhost origin
      if (process.env.NODE_ENV !== "production") {
        if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
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
          // Make sure to send error response before disconnecting
          const errorResponse = res.status(400).json({ 
            ok: false,
            error: "Verification failed: " + (verifyErr.message || verifyErr.toString()),
            details: verifyErr.data?.error || "Unknown error"
          });
          if (client) await client.disconnect();
          return errorResponse;
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

// GET WALLET STATUS (balance, verification status, etc.)
app.get("/api/wallet/status", requireAuth, async (req, res) => {
  let client;
  try {
    const userId = req.session.user.id;

    db.get(
      "SELECT wallet_address, is_verified, created_at, verified_at FROM user_wallets WHERE user_id = ?",
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

          return res.json({
            ok: true,
            connected: true,
            verified: !!wallet.is_verified,
            wallet: {
              address: wallet.wallet_address,
              existsOnLedger: true,
              balanceXrp: balanceXrp,
              sequence: sequence,
              createdAt: wallet.created_at,
              verifiedAt: wallet.verified_at,
            },
          });
        } catch (statusErr) {
          console.error("Status check error:", statusErr);
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

    // Try to use user's wallet first, fallback to server wallet
    let payerWallet;
    try {
      const userWallet = await new Promise((resolve, reject) => {
        getUserWallet(userId, (err, wallet) => {
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
    
    if (!ownerAddress || typeof ownerAddress !== "string" || ownerAddress.trim() === "") {
      return res.status(400).json({ error: "Missing or invalid ownerAddress" });
    }

    if (offerSequence === undefined || offerSequence === null || offerSequence === "") {
      return res.status(400).json({ error: "Missing offerSequence" });
    }

    const seed = process.env.PAYEE_SEED || process.env.PAYER_SEED;
    if (!seed) {
      return res.status(500).json({ error: "Missing PAYEE_SEED or PAYER_SEED" });
    }

    const payeeWallet = xrpl.Wallet.fromSeed(seed);
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
    if (!Number.isFinite(deadline) || deadline <= nowUnix) {
      return res.status(400).json({ 
        error: "deadlineUnix must be a future timestamp" 
      });
    }

    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "Missing PAYER_SEED" });
    }

    const clientWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    client = await getClient();

    const result = await createFreelancerEscrow({
      client,
      clientWallet,
      freelancerAddress: freelancerAddress.trim(),
      amountXrp,
      deadlineUnix: deadline,
      preimage: preimage || null,
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

    return res.json({
      ok: true,
      txHash: result.result.result?.hash,
      offerSequence: result.offerSequence,
      txResult,
      amountXrp: Number(amountXrp),
      freelancerAddress: freelancerAddress.trim(),
      preimage: result.preimage, // Client saves this to release payment when satisfied
      condition: result.condition, // Can be shared with freelancer for transparency
      deadlineUnix: result.deadlineUnix,
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

// Note: Release happens when freelancer uses /escrow/finish with the preimage
// This endpoint just validates and formats the release instruction

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
