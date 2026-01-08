// Validation utilities for common checks

/**
 * Validate XRPL address format
 */
export function isValidXRPLAddress(address) {
  if (!address || typeof address !== "string") return false;
  return /^r[1-9A-HJ-NP-Za-km-z]{25,34}$/.test(address.trim());
}

/**
 * Validate XRPL seed format
 */
export function isValidXRPLSeed(seed) {
  if (!seed || typeof seed !== "string") return false;
  const trimmed = seed.trim();
  if (!trimmed.startsWith("s")) return false;
  if (trimmed.length < 25 || trimmed.length > 35) return false;
  return /^s[1-9A-HJ-NP-Za-km-z]+$/.test(trimmed);
}

/**
 * Normalize seed - remove whitespace and invisible characters
 */
export function normalizeSeed(seed) {
  if (!seed || typeof seed !== "string") return seed;
  return seed
    .trim()
    .replace(/\s+/g, "")
    .replace(/[\u200B-\u200D\uFEFF\u00A0]/g, "")
    .replace(/[\x00-\x1F\x7F-\x9F]/g, "");
}

/**
 * Validate amount (positive number)
 */
export function isValidAmount(amount, min = 0.000001) {
  const num = Number(amount);
  return Number.isFinite(num) && num >= min;
}

/**
 * Validate unix timestamp (positive number, optionally in future)
 */
export function isValidUnixTimestamp(timestamp, mustBeFuture = false) {
  const num = Number(timestamp);
  if (!Number.isFinite(num) || num <= 0) return false;
  if (mustBeFuture) {
    const nowUnix = Math.floor(Date.now() / 1000);
    return num > nowUnix;
  }
  return true;
}

/**
 * Validate email format
 */
export function isValidEmail(email) {
  if (!email || typeof email !== "string") return false;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email.trim().toLowerCase());
}

/**
 * Validate payment method
 */
export function isValidPaymentMethod(method) {
  return method === "creditcard" || method === "paynow";
}

/**
 * Validate withdrawal method
 */
export function isValidWithdrawalMethod(method) {
  return method === "bank" || method === "paynow";
}
