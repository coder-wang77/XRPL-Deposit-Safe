import xrpl from "xrpl";

// Connect to XRPL Testnet
export async function getClient() {
  const client = new xrpl.Client("wss://s.altnet.rippletest.net:51233");
  await client.connect();
  return client;
}

// Convert XRP -> drops (XRPL uses drops in tx fields)
export function xrpToDrops(xrp) {
  return xrpl.xrpToDrops(String(xrp));
}

// Read escrow from ledger (so we can check it exists + times)
export async function getEscrowEntry({ client, ownerAddress, offerSequence }) {
  const resp = await client.request({
  command: "ledger_entry",
  ledger_index: "validated", // or "current"
  escrow: { owner: ownerAddress, seq: Number(offerSequence) },
});

  return resp.result?.node; // throws if not found
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
}) {
  // Build the EscrowCreate transaction
  const tx = {
    TransactionType: "EscrowCreate",
    Account: payerWallet.classicAddress,
    Destination: payeeAddress,
    Amount: xrpToDrops(amountXrp),
    FinishAfter: toRippleTime(finishAfterUnix),
  };

  if (cancelAfterUnix) {
    tx.CancelAfter = toRippleTime(cancelAfterUnix);
  }

  // Autofill fee + sequence
  const prepared = await client.autofill(tx);

  // Sign with payer
  const signed = payerWallet.sign(prepared);

  // Submit and wait for validation
  const result = await client.submitAndWait(signed.tx_blob);
  return { result, offerSequence: prepared.Sequence };

}

// finish an escrow to payee
export async function finishEscrow({ client, payeeWallet, ownerAddress, offerSequence }) {
  const seq = Number(offerSequence);
  if (!ownerAddress || !Number.isFinite(seq)) {
    throw new Error("Invalid ownerAddress or offerSequence");
  }

  // 1) Fetch escrow from ledger (proves it exists, shows Destination & FinishAfter)
  const escrow = await getEscrowEntry({ client, ownerAddress, offerSequence });

  // 2) Enforce: only Destination can finish (unless you implement Conditions/third-party)
  if (escrow.Destination !== payeeWallet.classicAddress) {
    throw new Error(
      `Not destination. Escrow Destination=${escrow.Destination}, you=${payeeWallet.classicAddress}`
    );
  }

  // 3) Enforce: FinishAfter has passed (if present)
  if (escrow.FinishAfter) {
    const nowUnix = Math.floor(Date.now() / 1000);
    const finishUnix = rippleTimeToUnix(escrow.FinishAfter);
    if (nowUnix < finishUnix) {
      throw new Error(`Too early. FinishAfter=${finishUnix} (unix), now=${nowUnix}`);
    }
  }

  // 4) Submit EscrowFinish
  const tx = {
    TransactionType: "EscrowFinish",
    Account: payeeWallet.classicAddress,
    Owner: ownerAddress,
    OfferSequence: seq,
  };

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
  const seq = Number(offerSequence);
  if (!ownerAddress || !Number.isFinite(seq)) {
    throw new Error("Invalid ownerAddress or offerSequence");
  }

  // 1) Fetch escrow entry
  const escrow = await getEscrowEntry({ client, ownerAddress, offerSequence });

  // 2) Enforce: only Owner can cancel
  if (ownerAddress !== payerWallet.classicAddress) {
    throw new Error(`Not owner. Owner=${ownerAddress}, you=${payerWallet.classicAddress}`);
  }

  // 3) Enforce: CancelAfter has passed (if present)
  if (escrow.CancelAfter) {
    const nowUnix = Math.floor(Date.now() / 1000);
    const cancelUnix = rippleTimeToUnix(escrow.CancelAfter);
    if (nowUnix < cancelUnix) {
      throw new Error(`Too early. CancelAfter=${cancelUnix} (unix), now=${nowUnix}`);
    }
  } else {
    // If you didn't set CancelAfter, canceling is not allowed by time rule
    // (You could still cancel if escrow has Condition? but that's different.)
    throw new Error("Escrow has no CancelAfter set; cancel not allowed by time.");
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

