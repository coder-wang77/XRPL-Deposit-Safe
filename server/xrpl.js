import xrpl from "xrpl";
import crypto from "crypto";

// Connect to XRPL Testnet
export async function getClient() {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();
  return client;
}

// ======================
// CONDITIONAL ESCROW UTILITIES
// ======================

/**
 * Generate a random preimage (secret) for conditional escrow
 * @returns {string} Hex-encoded preimage (32 bytes = 64 hex chars)
 */
export function generatePreimage() {
  return crypto.randomBytes(32).toString("hex").toUpperCase();
}

/**
 * Create a condition (SHA-256 crypto-condition) from a preimage
 * XRPL uses crypto-condition format: type byte (0x02 for SHA-256) + length + hash
 * @param {string} preimage - Hex-encoded preimage
 * @returns {string} Hex-encoded crypto-condition
 */
export function createCondition(preimage) {
  if (!preimage || typeof preimage !== "string") {
    throw new Error("Preimage must be a non-empty string");
  }
  
  // Remove any whitespace and convert to lowercase for hashing
  const cleanPreimage = preimage.replace(/\s+/g, "").toLowerCase();
  
  // Convert hex string to buffer, hash it
  const preimageBuffer = Buffer.from(cleanPreimage, "hex");
  const hash = crypto.createHash("sha256").update(preimageBuffer).digest();
  
  // XRPL crypto-condition format for SHA-256:
  // Type: 0x02 (SHA-256 condition type)
  // Length: 0x20 (32 bytes for SHA-256 hash)
  // Hash: 32-byte SHA-256 hash
  const type = Buffer.from([0x02]); // SHA-256 crypto-condition type
  const length = Buffer.from([hash.length]); // Length of hash (32 bytes = 0x20)
  const condition = Buffer.concat([type, length, hash]);
  
  // Return as hex string (uppercase for XRPL compatibility)
  return condition.toString("hex").toUpperCase();
}

/**
 * Validate that a preimage matches a condition
 * @param {string} preimage - Hex-encoded preimage
 * @param {string} condition - Hex-encoded crypto-condition
 * @returns {boolean} True if preimage matches condition
 */
export function validatePreimage(preimage, condition) {
  try {
    // Condition is now in crypto-condition format (type + length + hash)
    // Extract just the hash part (skip first 2 bytes: type 0x02 and length 0x20)
    const conditionBuffer = Buffer.from(condition.replace(/\s+/g, ""), "hex");
    if (conditionBuffer.length < 34) {
      return false; // Invalid format
    }
    
    // Extract hash from condition (bytes 2-33, after type and length)
    const conditionHash = conditionBuffer.slice(2, 34);
    
    // Compute hash from preimage
    const cleanPreimage = preimage.replace(/\s+/g, "").toLowerCase();
    const preimageBuffer = Buffer.from(cleanPreimage, "hex");
    const computedHash = crypto.createHash("sha256").update(preimageBuffer).digest();
    
    // Compare hashes
    return computedHash.equals(conditionHash);
  } catch (err) {
    return false;
  }
}

/**
 * Generate a condition-fulfillment pair for conditional escrow
 * Useful for applications where you want to create the condition now
 * but provide the fulfillment later (e.g., hotel booking confirmation)
 * @returns {{preimage: string, condition: string}}
 */
export function generateConditionPair() {
  const preimage = generatePreimage();
  const condition = createCondition(preimage);
  return { preimage, condition };
}

// Convert XRP -> drops (XRPL uses drops in tx fields)
export function xrpToDrops(xrp) {
  return xrpl.xrpToDrops(String(xrp));
}

// Read escrow from ledger (so we can check it exists + times)
export async function getEscrowEntry({ client, ownerAddress, offerSequence }) {
  try {
    const resp = await client.request({
      command: "ledger_entry",
      ledger_index: "validated", // or "current"
      escrow: { owner: ownerAddress, seq: Number(offerSequence) },
    });

    if (!resp.result?.node) {
      const error = new Error("Escrow entry not found");
      error.error = "entryNotFound";
      throw error;
    }

    return resp.result.node;
  } catch (err) {
    // If it's already our custom error, re-throw it
    if (err.error === "entryNotFound") {
      throw err;
    }
    
    // Handle XRPL API errors
    if (err.error === "entryNotFound" || err.data?.error === "entryNotFound") {
      const error = new Error(`Escrow entry not found. Owner: ${ownerAddress}, Sequence: ${offerSequence}`);
      error.error = "entryNotFound";
      throw error;
    }
    
    // Re-throw other errors with context
    throw new Error(`Failed to fetch escrow entry: ${err.message || String(err)}`);
  }
}

// Convert unix seconds -> ripple epoch seconds
export function toRippleTime(unixSeconds) {
  const RIPPLE_EPOCH_OFFSET = 946684800;
  const u = Number(unixSeconds);
  if (!Number.isFinite(u)) throw new Error("Invalid unixSeconds for toRippleTime");
  return u - RIPPLE_EPOCH_OFFSET;
}
// Convert ripple time -> unix seconds (useful for status checks)
export function rippleTimeToUnix(rippleSeconds) {
  // ripple epoch starts 2000-01-01; unix epoch starts 1970-01-01
  const RIPPLE_EPOCH_OFFSET = 946684800;
  return Number(rippleSeconds) + RIPPLE_EPOCH_OFFSET;
}

// create an escrow from payer
export async function createEscrow({
  client,
  payerWallet,
  payeeAddress,
  amountXrp,
  finishAfterUnix,
  cancelAfterUnix,
  condition, // Optional: hex-encoded crypto-condition (for conditional escrow)
}) {
  // Validate inputs
  if (!payeeAddress || typeof payeeAddress !== "string" || payeeAddress.trim() === "") {
    throw new Error("Invalid payeeAddress: must be a non-empty string");
  }

  // Validate XRPL address format (basic check)
  if (!/^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(payeeAddress)) {
    throw new Error(`Invalid XRPL address format: ${payeeAddress}`);
  }

  // Validate amount
  const amount = Number(amountXrp);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid amountXrp: must be a positive number, got ${amountXrp}`);
  }

  // Minimum XRP amount is 0.000001 (1 drop = 0.000001 XRP)
  if (amount < 0.000001) {
    throw new Error(`Amount too small: minimum is 0.000001 XRP, got ${amount}`);
  }

  // Validate finishAfterUnix
  const finish = Number(finishAfterUnix);
  if (!Number.isFinite(finish) || finish <= 0) {
    throw new Error(`Invalid finishAfterUnix: must be a positive unix timestamp, got ${finishAfterUnix}`);
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  if (finish <= nowUnix) {
    throw new Error(
      `finishAfterUnix must be in the future. Provided: ${new Date(finish * 1000).toISOString()}, ` +
      `Current time: ${new Date(nowUnix * 1000).toISOString()}`
    );
  }

  // Validate cancelAfterUnix if provided
  let cancel = null;
  if (cancelAfterUnix !== null && cancelAfterUnix !== undefined) {
    cancel = Number(cancelAfterUnix);
    if (!Number.isFinite(cancel) || cancel <= 0) {
      throw new Error(`Invalid cancelAfterUnix: must be a positive unix timestamp, got ${cancelAfterUnix}`);
    }

    if (cancel <= nowUnix) {
      throw new Error(
        `cancelAfterUnix must be in the future. Provided: ${new Date(cancel * 1000).toISOString()}, ` +
        `Current time: ${new Date(nowUnix * 1000).toISOString()}`
      );
    }

    // CancelAfter must be after FinishAfter
    if (cancel <= finish) {
      throw new Error(
        `cancelAfterUnix must be greater than finishAfterUnix. ` +
        `Finish: ${new Date(finish * 1000).toISOString()}, ` +
        `Cancel: ${new Date(cancel * 1000).toISOString()}`
      );
    }
  }

  // Prevent creating escrow to self
  if (payeeAddress === payerWallet.classicAddress) {
    throw new Error("Cannot create escrow to the same address (payer and payee cannot be the same)");
  }

  // Validate condition if provided (must be valid hex, typically 64 chars for SHA-256)
  let conditionHex = null;
  if (condition) {
    if (typeof condition !== "string" || condition.trim() === "") {
      throw new Error("Condition must be a non-empty hex string");
    }
    
    conditionHex = condition.replace(/\s+/g, "").toUpperCase();
    
    // XRPL conditions are typically SHA-256 hashes (64 hex chars)
    // But we'll accept any valid hex string
    if (!/^[0-9A-F]+$/i.test(conditionHex)) {
      throw new Error("Condition must be a valid hex string");
    }
    
    // Crypto-condition format: type (1 byte) + length (1 byte) + hash (32 bytes) = 34 bytes = 68 hex chars
    // Minimum valid condition is 34 bytes
    if (conditionHex.length < 68) {
      throw new Error("Condition must be at least 68 hex characters (34 bytes for crypto-condition format)");
    }
  }

  // Build the EscrowCreate transaction
  const tx = {
    TransactionType: "EscrowCreate",
    Account: payerWallet.classicAddress,
    Destination: payeeAddress,
    Amount: xrpToDrops(amount),
    FinishAfter: toRippleTime(finish),
  };

  if (cancel) {
    tx.CancelAfter = toRippleTime(cancel);
  }

  // Add Condition field for conditional escrow
  if (conditionHex) {
    tx.Condition = conditionHex;
  }

  // Autofill fee + sequence
  const prepared = await client.autofill(tx);

  // Sign with payer
  const signed = payerWallet.sign(prepared);

  // Submit and wait for validation
  const result = await client.submitAndWait(signed.tx_blob);
  return { result, offerSequence: prepared.Sequence };
}

/**
 * Create a freelancer payment escrow (specialized flow)
 * Client locks payment → Freelancer delivers → Client releases OR auto-refund after deadline
 * 
 * @param {Object} params
 * @param {Object} params.client - XRPL client
 * @param {Object} params.clientWallet - Client's wallet (payer)
 * @param {string} params.freelancerAddress - Freelancer's XRPL address (payee)
 * @param {number} params.amountXrp - Amount in XRP
 * @param {number} params.deadlineUnix - Deadline unix timestamp (when auto-refund becomes available)
 * @param {string} params.preimage - Optional preimage (if not provided, generates one)
 * @returns {Object} Escrow creation result with condition info
 */
export async function createFreelancerEscrow({
  client,
  clientWallet,
  freelancerAddress,
  amountXrp,
  deadlineUnix,
  preimage = null,
}) {
  // Generate condition-fulfillment pair if not provided
  let conditionPair;
  if (preimage) {
    const condition = createCondition(preimage);
    conditionPair = { preimage, condition };
  } else {
    conditionPair = generateConditionPair();
  }

  // Create escrow with condition
  // FinishAfter is set to deadline - this allows:
  // 1. Client can finish early by providing fulfillment (when satisfied)
  // 2. Auto-refund becomes available after deadline if condition not fulfilled
  // Note: cancelAfterUnix must be > finishAfterUnix, so we add 1 second to deadline
  const result = await createEscrow({
    client,
    payerWallet: clientWallet,
    payeeAddress: freelancerAddress,
    amountXrp,
    finishAfterUnix: deadlineUnix, // Can finish at deadline or earlier with preimage
    cancelAfterUnix: deadlineUnix + 1, // Can refund 1 second after deadline (ensures cancelAfter > finishAfter)
    condition: conditionPair.condition,
  });

  return {
    ...result,
    preimage: conditionPair.preimage,
    condition: conditionPair.condition,
    deadlineUnix,
  };
}

// finish an escrow to payee
export async function finishEscrow({ client, payeeWallet, ownerAddress, offerSequence, fulfillment }) {
  // Validate inputs
  if (!ownerAddress || typeof ownerAddress !== "string" || ownerAddress.trim() === "") {
    throw new Error("Invalid ownerAddress: must be a non-empty string");
  }
  
  const seq = Number(offerSequence);
  if (!Number.isFinite(seq) || seq <= 0 || !Number.isInteger(seq)) {
    throw new Error(`Invalid offerSequence: must be a positive integer, got ${offerSequence}`);
  }

  // 1) Fetch escrow from ledger (proves it exists, shows Destination & FinishAfter)
  let escrow;
  try {
    escrow = await getEscrowEntry({ client, ownerAddress, offerSequence });
  } catch (err) {
    if (err.error === "entryNotFound" || err.message?.includes("entryNotFound")) {
      throw new Error(`Escrow not found. Owner: ${ownerAddress}, Sequence: ${seq}`);
    }
    throw new Error(`Failed to fetch escrow entry: ${err.message || String(err)}`);
  }

  if (!escrow) {
    throw new Error(`Escrow entry not found. Owner: ${ownerAddress}, Sequence: ${seq}`);
  }

  // 2) Enforce: only Destination can finish (unless you implement Conditions/third-party)
  if (escrow.Destination !== payeeWallet.classicAddress) {
    throw new Error(
      `Not authorized to finish this escrow. Escrow Destination: ${escrow.Destination}, Your address: ${payeeWallet.classicAddress}`
    );
  }

  // 3) Check if escrow has a Condition (conditional escrow)
  const hasCondition = escrow.Condition && escrow.Condition.trim() !== "";
  
  // For conditional escrows, validate fulfillment is provided
  if (hasCondition && !fulfillment) {
    throw new Error(
      `This escrow requires a fulfillment (preimage) to be finished. ` +
      `The escrow has condition: ${escrow.Condition.substring(0, 16)}... ` +
      `Please provide the fulfillment/preimage that matches this condition.`
    );
  }

  // If fulfillment is provided, validate it matches the condition
  if (hasCondition && fulfillment) {
    const isValid = validatePreimage(fulfillment, escrow.Condition);
    if (!isValid) {
      throw new Error(
        `Invalid fulfillment. The provided preimage does not match the escrow condition. ` +
        `Expected condition: ${escrow.Condition.substring(0, 16)}...`
      );
    }
  }

  // 4) Enforce deadline/FinishAfter rules
  if (escrow.FinishAfter) {
    const nowUnix = Math.floor(Date.now() / 1000);
    const finishUnix = rippleTimeToUnix(escrow.FinishAfter);
    
    if (hasCondition) {
      // For conditional escrows with deadline:
      // - Can finish BEFORE deadline with fulfillment (preimage)
      // - Cannot finish AFTER deadline (deadline passed, client can refund instead)
      if (nowUnix >= finishUnix) {
        throw new Error(
          `Deadline has passed. Cannot finish escrow after deadline. ` +
          `Deadline: ${new Date(finishUnix * 1000).toISOString()}, ` +
          `Current time: ${new Date(nowUnix * 1000).toISOString()}. ` +
          `The client can now refund the payment.`
        );
      }
      // Before deadline: require fulfillment (preimage) - already validated above
      if (!fulfillment) {
        throw new Error(
          `Fulfillment (preimage) is required to finish this conditional escrow. ` +
          `You must provide the preimage that matches the escrow condition.`
        );
      }
    } else {
      // Time-based escrow: Must wait for FinishAfter
      if (nowUnix < finishUnix) {
        const remainingSeconds = finishUnix - nowUnix;
        const remainingMinutes = Math.ceil(remainingSeconds / 60);
        throw new Error(
          `Too early to finish escrow. FinishAfter: ${new Date(finishUnix * 1000).toISOString()}, ` +
          `Current time: ${new Date(nowUnix * 1000).toISOString()}, ` +
          `Remaining: ${remainingMinutes} minute(s)`
        );
      }
    }
  }

  // 5) Submit EscrowFinish
  const tx = {
    TransactionType: "EscrowFinish",
    Account: payeeWallet.classicAddress,
    Owner: ownerAddress,
    OfferSequence: seq,
  };

  // Add Fulfillment field if condition exists and fulfillment is provided
  if (hasCondition && fulfillment) {
    const fulfillmentHex = fulfillment.replace(/\s+/g, "").toUpperCase();
    if (!/^[0-9A-F]+$/i.test(fulfillmentHex)) {
      throw new Error("Fulfillment must be a valid hex string");
    }
    tx.Fulfillment = fulfillmentHex;
  }

  const prepared = await client.autofill(tx);
  const signed = payeeWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  // 5) Return parsed outcome
  const txResult = result.result?.meta?.TransactionResult;
  return {
    txResult,
    hash: result.result?.hash,
    validated: result.result?.validated,
    raw: result,
  };
}

// refund an escrow to payer
export async function cancelEscrow({ client, payerWallet, ownerAddress, offerSequence }) {
  // Validate inputs
  if (!ownerAddress || typeof ownerAddress !== "string" || ownerAddress.trim() === "") {
    throw new Error("Invalid ownerAddress: must be a non-empty string");
  }
  
  const seq = Number(offerSequence);
  if (!Number.isFinite(seq) || seq <= 0 || !Number.isInteger(seq)) {
    throw new Error(`Invalid offerSequence: must be a positive integer, got ${offerSequence}`);
  }

  // 1) Fetch escrow entry
  let escrow;
  try {
    escrow = await getEscrowEntry({ client, ownerAddress, offerSequence });
  } catch (err) {
    if (err.error === "entryNotFound" || err.message?.includes("entryNotFound")) {
      throw new Error(`Escrow not found. Owner: ${ownerAddress}, Sequence: ${seq}`);
    }
    throw new Error(`Failed to fetch escrow entry: ${err.message || String(err)}`);
  }

  if (!escrow) {
    throw new Error(`Escrow entry not found. Owner: ${ownerAddress}, Sequence: ${seq}`);
  }

  // 2) Enforce: only Owner can cancel
  if (ownerAddress !== payerWallet.classicAddress) {
    throw new Error(
      `Not authorized to cancel this escrow. Escrow Owner: ${ownerAddress}, Your address: ${payerWallet.classicAddress}`
    );
  }

  // 3) Enforce: CancelAfter has passed (if present)
  if (escrow.CancelAfter) {
    const nowUnix = Math.floor(Date.now() / 1000);
    const cancelUnix = rippleTimeToUnix(escrow.CancelAfter);
    if (nowUnix < cancelUnix) {
      const remainingSeconds = cancelUnix - nowUnix;
      const remainingMinutes = Math.ceil(remainingSeconds / 60);
      throw new Error(
        `Too early to cancel escrow. CancelAfter: ${new Date(cancelUnix * 1000).toISOString()}, ` +
        `Current time: ${new Date(nowUnix * 1000).toISOString()}, ` +
        `Remaining: ${remainingMinutes} minute(s)`
      );
    }
  } else {
    // If you didn't set CancelAfter, canceling is not allowed by time rule
    // (You could still cancel if escrow has Condition? but that's different.)
    throw new Error(
      "Escrow has no CancelAfter set; cancel not allowed by time. " +
      "The escrow can only be finished by the destination address."
    );
  }

  // 4) Submit EscrowCancel (signed by payer/owner)
  const tx = {
    TransactionType: "EscrowCancel",
    Account: payerWallet.classicAddress,
    Owner: ownerAddress,
    OfferSequence: seq,
  };

  const prepared = await client.autofill(tx);
  const signed = payerWallet.sign(prepared);
  const result = await client.submitAndWait(signed.tx_blob);

  const txResult = result.result?.meta?.TransactionResult;
  return {
    txResult,
    hash: result.result?.hash,
    validated: result.result?.validated,
    raw: result,
  };
}

