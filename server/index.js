import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import xrpl from "xrpl";
import { getClient, createEscrow, finishEscrow, cancelEscrow} from "./xrpl.js";

dotenv.config();
const app = express();
console.log("✅ Server starting...");
console.log("✅ PAYER_SEED loaded:", !!process.env.PAYER_SEED);

app.use(express.json());
app.use(
  cors({
    origin: "http://127.0.0.1:5501",
    credentials: true,
  })
);

// health check
app.get("/health", (req, res) => {
  console.log("PAYER_SEED loaded:", !!process.env.PAYER_SEED);
  res.send("Server is running");
});

// LOGIN
app.post("/api/login", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  // demo login (no DB yet)
  res.json({
    ok: true,
    user: { email },
  });
});

// SIGNUP
app.post("/api/signup", (req, res) => {
  const { email, password } = req.body || {};

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password required" });
  }

  // demo signup (no DB yet)
  res.json({
    ok: true,
    user: { email },
  });
});

// ESCROW CREATE (deposit lock)
app.post("/escrow/create", async (req, res) => {
  try {
    const { payeeAddress, amountXrp, finishAfterUnix, cancelAfterUnix } = req.body || {};

        // ---- VALIDATION & DEBUG (ADD THIS BLOCK) ----
    const finish = Number(finishAfterUnix);
    const cancel = cancelAfterUnix ? Number(cancelAfterUnix) : null;

    console.log("finishAfterUnix raw:", finishAfterUnix, "->", finish);
    console.log("cancelAfterUnix raw:", cancelAfterUnix, "->", cancel);

    // Must be valid numbers
    if (!Number.isFinite(finish)) {
      return res.status(400).json({
        error: "finishAfterUnix must be a valid number (unix seconds)",
      });
    }

    if (cancelAfterUnix && !Number.isFinite(cancel)) {
      return res.status(400).json({
        error: "cancelAfterUnix must be a valid number (unix seconds)",
      });
    }

    // finish must be after now
    const now = Math.floor(Date.now() / 1000);
    if (finish <= now) {
      return res.status(400).json({
        error: "finishAfterUnix is too small. Use unix seconds like now+60.",
      });
    }

    // cancel must be after finish
    if (cancel && cancel <= finish) {
      return res.status(400).json({
        error: "cancelAfterUnix must be greater than finishAfterUnix",
      });
    }
    // ---- END VALIDATION BLOCK ----

    if (!payeeAddress || !amountXrp || !finish) {
      return res.status(400).json({
        error: "Missing payeeAddress / amountXrp / finishAfterUnix",
      });
    }

    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ error: "Missing PAYER_SEED in server/.env" });
    }

    const payerWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    console.log("PAYER ADDRESS (derived):", payerWallet.classicAddress);

    const client = await getClient();

    const { result, offerSequence } = await createEscrow({
      client,
      payerWallet,
      payeeAddress,
      amountXrp,
      finishAfterUnix: finish,
      cancelAfterUnix: cancel,
    });


    await client.disconnect();

    const txResult = result.result?.meta?.TransactionResult;
    const engineResult = result.result?.engine_result;
    const engineMsg = result.result?.engine_result_message;

    if (txResult !== "tesSUCCESS") {
      return res.status(400).json({
        ok: false,
        txResult,
        engine_result: engineResult,
        engine_result_message: engineMsg,
        txHash: result.result?.hash,
        message: "EscrowCreate failed (not created on-ledger)",
      });
    }

    return res.json({
      ok: true,
      txHash: result.result?.hash,
      offerSequence,
      txResult,
      engine_result: engineResult,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message || String(err) });
  }
});

// ESCROW FINISH (claim deposit)
app.post("/escrow/finish", async (req, res) => {
  let client;
  try {
    const { ownerAddress, offerSequence } = req.body || {};
    if (!ownerAddress || offerSequence === undefined) {
      return res.status(400).json({ ok: false, error: "Missing ownerAddress / offerSequence" });
    }

    const seed = process.env.PAYEE_SEED || process.env.PAYER_SEED; // same wallet demo ok
    if (!seed) return res.status(500).json({ ok: false, error: "Missing PAYER_SEED (or PAYEE_SEED)" });

    const payeeWallet = xrpl.Wallet.fromSeed(seed);
    client = await getClient();

    const out = await finishEscrow({
      client,
      payeeWallet,
      ownerAddress,
      offerSequence,
    });

    const ok = out.txResult === "tesSUCCESS";
    return res.json({
      ok,
      txResult: out.txResult,
      txHash: out.hash,
      validated: out.validated,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

// ESCROW CANCEL (refund deposit)
app.post("/escrow/cancel", async (req, res) => {
  let client;
  try {
    const { ownerAddress, offerSequence } = req.body || {};
    if (!ownerAddress || offerSequence === undefined) {
      return res.status(400).json({ ok: false, error: "Missing ownerAddress / offerSequence" });
    }

    if (!process.env.PAYER_SEED) {
      return res.status(500).json({ ok: false, error: "Missing PAYER_SEED" });
    }

    const payerWallet = xrpl.Wallet.fromSeed(process.env.PAYER_SEED);
    client = await getClient();

    const out = await cancelEscrow({
      client,
      payerWallet,
      ownerAddress,
      offerSequence,
    });

    const ok = out.txResult === "tesSUCCESS";
    return res.json({
      ok,
      txResult: out.txResult,
      txHash: out.hash,
      validated: out.validated,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || String(err) });
  } finally {
    if (client) await client.disconnect();
  }
});

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


app.listen(3001, () => {
  console.log("Backend running at http://localhost:3001");
});

