import xrpl from "xrpl";
import crypto from "crypto";
import cc from "five-bells-condition";
import { getClient } from "./utils/xrpl-client.js";
import { XRPL_CONSTANTS } from "./utils/constants.js";

// Re-export getClient for backward compatibility
export { getClient };

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
 * Create a condition (PREIMAGE-SHA-256 crypto-condition) from a preimage
 * XRPL requires conditions in the proper crypto-condition format
 * @param {string} preimage - Hex-encoded preimage (32 bytes = 64 hex chars)
 * @returns {string} Hex-encoded condition in PREIMAGE-SHA-256 format
 */
export function createCondition(preimage) {
  if (!preimage || typeof preimage !== "string") {
    throw new Error("Preimage must be a non-empty string");
  }
  
  // Remove any whitespace and convert to lowercase
  const cleanPreimage = preimage.replace(/\s+/g, "").toLowerCase();
  
  // Convert hex string to buffer
  const preimageBuffer = Buffer.from(cleanPreimage, "hex");
  
  // Validate preimage is 32 bytes (64 hex chars)
  if (preimageBuffer.length !== 32) {
    throw new Error(`Preimage must be exactly 32 bytes (64 hex characters). Got ${preimageBuffer.length} bytes.`);
  }
  
  // Create PREIMAGE-SHA-256 fulfillment using five-bells-condition
  const fulfillment = new cc.PreimageSha256();
  fulfillment.setPreimage(preimageBuffer);
  
  // Get the condition in binary format and convert to hex
  const conditionBinary = fulfillment.getConditionBinary();
  const conditionHex = conditionBinary.toString("hex").toUpperCase();
  
  return conditionHex;
}

/**
 * Validate that a preimage matches a condition
 * @param {string} preimage - Hex-encoded preimage
 * @param {string} condition - Hex-encoded crypto-condition
 * @returns {boolean} True if preimage matches condition
 */
export function validatePreimage(preimage, condition) {
  if (!preimage || !condition) return false;
  
  try {
    // Create fulfillment from preimage
    const cleanPreimage = preimage.replace(/\s+/g, "").toLowerCase();
    const preimageBuffer = Buffer.from(cleanPreimage, "hex");
    
    if (preimageBuffer.length !== 32) {
      return false;
    }
    
    const fulfillment = new cc.PreimageSha256();
    fulfillment.setPreimage(preimageBuffer);
    
    // Get condition from fulfillment
    const computedCondition = fulfillment.getConditionBinary().toString("hex").toUpperCase();
    
    // Compare with provided condition (normalize both to uppercase, remove whitespace)
    const cleanCondition = condition.toUpperCase().replace(/\s+/g, "");
    return computedCondition === cleanCondition;
  } catch (e) {
    console.error("Preimage validation error:", e);
    return false;
  }
}

/**
 * Generate a condition-fulfillment pair for conditional escrow
 * Useful for applications where you want to create the condition now
 * but provide the fulfillment later (e.g., hotel booking confirmation)
 * @returns {{preimage: string, condition: string, fulfillment: string}}
 */
export function generateConditionPair() {
  // Generate random 32-byte preimage
  const preimageData = crypto.randomBytes(32);
  const preimage = preimageData.toString("hex").toUpperCase();
  
  // Create fulfillment using five-bells-condition
  const fulfillment = new cc.PreimageSha256();
  fulfillment.setPreimage(preimageData);
  
  // Get condition in proper format
  const conditionBinary = fulfillment.getConditionBinary();
  const condition = conditionBinary.toString("hex").toUpperCase();
  
  // Get fulfillment hex (for finishing escrow)
  const fulfillmentBinary = fulfillment.serializeBinary();
  const fulfillmentHex = fulfillmentBinary.toString("hex").toUpperCase();
  
  return { preimage, condition, fulfillment: fulfillmentHex };
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
  const u = Number(unixSeconds);
  if (!Number.isFinite(u)) throw new Error("Invalid unixSeconds for toRippleTime");
  return u - XRPL_CONSTANTS.RIPPLE_EPOCH_OFFSET;
}
// Convert ripple time -> unix seconds (useful for status checks)
export function rippleTimeToUnix(rippleSeconds) {
  return Number(rippleSeconds) + XRPL_CONSTANTS.RIPPLE_EPOCH_OFFSET;
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
  if (amount < XRPL_CONSTANTS.MIN_XRP_AMOUNT) {
    throw new Error(`Amount too small: minimum is ${XRPL_CONSTANTS.MIN_XRP_AMOUNT} XRP, got ${amount}`);
  }

  // Validate finishAfterUnix
  const finish = Number(finishAfterUnix);
  if (!Number.isFinite(finish) || finish <= 0) {
    throw new Error(`Invalid finishAfterUnix: must be a positive unix timestamp, got ${finishAfterUnix}`);
  }

  const nowUnix = Math.floor(Date.now() / 1000);
  const minFinishUnix = nowUnix + XRPL_CONSTANTS.MIN_FINISH_BUFFER_SECONDS; // Require at least 1 minute in the future (buffer)
  
  if (finish <= minFinishUnix) {
    throw new Error(
      `finishAfterUnix must be at least 1 minute in the future. Provided: ${new Date(finish * 1000).toISOString()}, ` +
      `Current time: ${new Date(nowUnix * 1000).toISOString()}, Minimum: ${new Date(minFinishUnix * 1000).toISOString()}`
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
    
    // XRPL PREIMAGE-SHA-256 conditions from five-bells-condition are typically 80+ hex chars
    // Format: A0258020[32-byte hash]810100
    // Minimum length should be around 80+ characters for proper format
    if (conditionHex.length < 64) {
      throw new Error(
        `Condition appears to be invalid. PREIMAGE-SHA-256 conditions are typically 80+ hex characters. ` +
        `Got ${conditionHex.length} characters: ${conditionHex.substring(0, 20)}...`
      );
    }
  }

  // Build the EscrowCreate transaction
  const finishRippleTime = toRippleTime(finish);
  const cancelRippleTime = cancel ? toRippleTime(cancel) : null;
  
  // Validate ripple times are positive
  if (finishRippleTime <= 0) {
    throw new Error(`Invalid FinishAfter ripple time: ${finishRippleTime}. Unix: ${finish}, Ripple: ${finishRippleTime}`);
  }
  
  if (cancelRippleTime !== null && cancelRippleTime <= 0) {
    throw new Error(`Invalid CancelAfter ripple time: ${cancelRippleTime}. Unix: ${cancel}, Ripple: ${cancelRippleTime}`);
  }
  
  // Build transaction - ensure all fields are correct types
  const tx = {
    TransactionType: "EscrowCreate",
    Account: payerWallet.classicAddress,
    Destination: payeeAddress,
    Amount: xrpToDrops(amount), // Must be string in drops
    FinishAfter: Number(finishRippleTime), // Must be number (ripple epoch seconds)
  };

  if (cancelRippleTime) {
    tx.CancelAfter = Number(cancelRippleTime); // Must be number (ripple epoch seconds)
  }

  // Add Condition field for conditional escrow
  // XRPL requires Condition in PREIMAGE-SHA-256 crypto-condition format
  // This format is longer than 64 chars (includes type information)
  if (conditionHex) {
    // PREIMAGE-SHA-256 conditions from five-bells-condition are typically 80+ hex chars
    // Format: A0258020[32-byte hash]810100
    if (conditionHex.length < 64) {
      throw new Error(
        `Condition appears to be invalid. PREIMAGE-SHA-256 conditions are typically 80+ hex characters. ` +
        `Got ${conditionHex.length} characters: ${conditionHex.substring(0, 20)}...`
      );
    }
    
    // XRPL expects the condition as a hex string
    tx.Condition = conditionHex;
  }

  // Log transaction for debugging
  console.log("EscrowCreate transaction:", JSON.stringify({
    TransactionType: tx.TransactionType,
    Account: tx.Account,
    Destination: tx.Destination,
    Amount: tx.Amount,
    AmountType: typeof tx.Amount,
    FinishAfter: tx.FinishAfter,
    FinishAfterType: typeof tx.FinishAfter,
    CancelAfter: tx.CancelAfter || 'none',
    CancelAfterType: tx.CancelAfter ? typeof tx.CancelAfter : 'none',
    Condition: conditionHex ? `${conditionHex.substring(0, 16)}...` : 'none',
    ConditionLength: conditionHex ? conditionHex.length : 0,
  }, null, 2));

  // Autofill fee + sequence
  let prepared;
  try {
    prepared = await client.autofill(tx);
  } catch (autofillErr) {
    console.error("Autofill error:", autofillErr);
    throw new Error(`Failed to prepare transaction: ${autofillErr.message}`);
  }

  // Sign with payer
  let signed;
  try {
    signed = payerWallet.sign(prepared);
  } catch (signErr) {
    console.error("Sign error:", signErr);
    throw new Error(`Failed to sign transaction: ${signErr.message}`);
  }

  // Submit and wait for validation
  let result;
  try {
    result = await client.submitAndWait(signed.tx_blob);
  } catch (submitErr) {
    // XRPL client errors have different structures - try to extract all possible error info
    console.error("Submit error - full details:", {
      message: submitErr.message,
      name: submitErr.name,
      data: submitErr.data,
      result: submitErr.result,
      response: submitErr.response,
      request: submitErr.request,
      // Try to get all properties
      allProps: Object.getOwnPropertyNames(submitErr).reduce((acc, key) => {
        try {
          acc[key] = submitErr[key];
        } catch (e) {
          acc[key] = '[unable to serialize]';
        }
        return acc;
      }, {})
    });
    
    // Try to extract error from different possible locations
    let txResult, engineResult, engineMsg, errorCode;
    
    if (submitErr.data) {
      txResult = submitErr.data.meta?.TransactionResult;
      engineResult = submitErr.data.engine_result;
      engineMsg = submitErr.data.engine_result_message;
      errorCode = submitErr.data.error_code;
    } else if (submitErr.result) {
      txResult = submitErr.result.meta?.TransactionResult;
      engineResult = submitErr.result.engine_result;
      engineMsg = submitErr.result.engine_result_message;
      errorCode = submitErr.result.error_code;
    }
    
    // Log what we found
    console.error("Extracted XRPL error info:", {
      txResult,
      engineResult,
      engineMsg,
      errorCode,
      hasData: !!submitErr.data,
      hasResult: !!submitErr.result
    });
    
    const errorMsg = engineMsg || submitErr.message || submitErr.toString();
    const errorType = txResult || engineResult || 'Unknown error';
    
    throw new Error(
      `Transaction failed: ${errorType}. ${errorMsg}${errorCode ? ` (Code: ${errorCode})` : ''}`
    );
  }
  
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
    // If preimage is provided, create condition from it
    const condition = createCondition(preimage);
    // Also create fulfillment for later use
    const cleanPreimage = preimage.replace(/\s+/g, "").toLowerCase();
    const preimageBuffer = Buffer.from(cleanPreimage, "hex");
    const fulfillment = new cc.PreimageSha256();
    fulfillment.setPreimage(preimageBuffer);
    const fulfillmentHex = fulfillment.serializeBinary().toString("hex").toUpperCase();
    conditionPair = { preimage, condition, fulfillment: fulfillmentHex };
  } else {
    conditionPair = generateConditionPair();
  }

  // Create escrow with condition
  // For conditional escrows:
  // - Client can finish anytime by providing fulfillment (condition)
  // - FinishAfter is a fallback time (set to allow early finishing)
  // - CancelAfter is the deadline (when auto-refund becomes available)
  const nowUnix = Math.floor(Date.now() / 1000);
  
  // Set finishAfterUnix to 1 hour before deadline, but ensure:
  // 1. It's at least 1 minute in the future (validation requirement)
  // 2. It's at least 1 minute before deadline (so finishAfterUnix < cancelAfterUnix)
  let finishAfterUnix = Math.max(nowUnix + XRPL_CONSTANTS.MIN_FINISH_BUFFER_SECONDS, deadlineUnix - 3600);
  // Ensure it's still less than the deadline
  if (finishAfterUnix >= deadlineUnix) {
    finishAfterUnix = deadlineUnix - XRPL_CONSTANTS.MIN_FINISH_BUFFER_SECONDS; // At least 1 minute before deadline
  }
  
  const result = await createEscrow({
    client,
    payerWallet: clientWallet,
    payeeAddress: freelancerAddress,
    amountXrp,
    finishAfterUnix: finishAfterUnix, // Fallback time (allows early finishing with condition)
    cancelAfterUnix: deadlineUnix, // Can refund after deadline
    condition: conditionPair.condition,
  });

  return {
    ...result,
    preimage: conditionPair.preimage,
    condition: conditionPair.condition,
    deadlineUnix,
  };
}

/**
 * Create a QA escrow (Quality Assurance with requirements checklist)
 * Client locks payment with requirements → Service provider delivers → 
 * AI verifies requirements → Service provider claims payment (before deadline) OR client refunds (after deadline)
 * 
 * @param {Object} params
 * @param {Object} params.client - XRPL client
 * @param {Object} params.clientWallet - Client's wallet (payer)
 * @param {string} params.providerAddress - Service provider's XRPL address (payee)
 * @param {number} params.amountXrp - Amount in XRP
 * @param {number} params.deadlineUnix - Deadline unix timestamp (when refund becomes available)
 * @param {string} params.preimage - Optional preimage (if not provided, generates one)
 * @returns {Object} Escrow creation result with condition info
 */
export async function createQAEscrow({
  client,
  clientWallet,
  providerAddress,
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

  // Create escrow with condition and deadline
  // Logic:
  // - FinishAfter = deadline (service provider can finish before deadline with preimage)
  // - CancelAfter = deadline + 1 (client can refund after deadline)
  // - Service provider needs preimage (automatically provided by server when AI verifies) to finish before deadline
  // - After deadline, only client can cancel/refund
  const result = await createEscrow({
    client,
    payerWallet: clientWallet,
    payeeAddress: providerAddress,
    amountXrp,
    finishAfterUnix: deadlineUnix, // Deadline - service provider can finish before this with preimage
    cancelAfterUnix: deadlineUnix + 1, // After deadline - client can refund
    condition: conditionPair.condition, // Preimage required to finish
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
  // Fulfillment can be either:
  // 1. A preimage (hex string) - we'll convert it to fulfillment format
  // 2. A serialized fulfillment (hex string) - use directly
  let fulfillmentHex = null;
  if (hasCondition && fulfillment) {
    const cleanFulfillment = fulfillment.replace(/\s+/g, "").toLowerCase();
    
    // Check if it's a preimage (64 hex chars) or already a fulfillment (longer)
    if (cleanFulfillment.length === 64) {
      // It's a preimage - convert to fulfillment
      try {
        const preimageBuffer = Buffer.from(cleanFulfillment, "hex");
        const fulfillmentObj = new cc.PreimageSha256();
        fulfillmentObj.setPreimage(preimageBuffer);
        fulfillmentHex = fulfillmentObj.serializeBinary().toString("hex").toUpperCase();
        
        // Validate it matches the condition
        const computedCondition = fulfillmentObj.getConditionBinary().toString("hex").toUpperCase();
        const escrowCondition = escrow.Condition.toUpperCase().replace(/\s+/g, "");
        if (computedCondition !== escrowCondition) {
          throw new Error(
            `Invalid preimage. The provided preimage does not match the escrow condition. ` +
            `Expected condition: ${escrow.Condition.substring(0, 16)}...`
          );
        }
      } catch (err) {
        throw new Error(
          `Failed to create fulfillment from preimage: ${err.message}`
        );
      }
      } else {
        // Assume it's already a serialized fulfillment - use it directly
        // XRPL will validate it when we submit
        fulfillmentHex = cleanFulfillment.toUpperCase();
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
  if (hasCondition && fulfillmentHex) {
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
    escrowAmountDrops: escrow?.Amount || null, // XRP amount locked in escrow (drops, string)
    escrow,
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

