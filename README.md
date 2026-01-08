# XRPL-Deposit-Safe
secure deposit using xrpl

## XLUSD escrow UX (important)

**XRPL escrows can only lock XRP** (native XRP). They cannot lock IOU tokens like XLUSD directly.

This project provides an **XLUSD-first** user experience by:
- Accepting **XLUSD amounts in the UI** (e.g. QA escrow payment in XLUSD)
- Converting that amount to **XRP for the on-ledger escrow** (server-side, configurable)
- When the service provider finishes the escrow, the server can **auto-convert released XRP → XLUSD** (requires an XLUSD trustline + DEX liquidity)

### Config
- **`XLUSD_TO_XRP_RATE`**: conversion rate used when locking XLUSD into XRP escrow (default `1`)
- **`AUTO_CONVERT_TO_XLUSD`**: auto-convert on escrow finish (default `true`)
