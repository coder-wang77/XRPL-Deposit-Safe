// Application constants

export const XRPL_CONSTANTS = {
  MIN_XRP_AMOUNT: 0.000001,
  MIN_FINISH_BUFFER_SECONDS: 60,
  DEFAULT_SESSION_MAX_AGE: 1000 * 60 * 60 * 2, // 2 hours
  REMEMBER_ME_MAX_AGE: 1000 * 60 * 60 * 24 * 7, // 7 days
  RIPPLE_EPOCH_OFFSET: 946684800,
};

export const DEFAULT_XLUSD_ISSUER = "rPT1Sjq2YGrBMTttX4gZHuKu5h8VwwE4Cq";
export const XLUSD_CURRENCY = "XLUSD";
export const XLUSD_PRICE_USD = 1.0;

export const PAYMENT_METHODS = {
  CREDIT_CARD: "creditcard",
  PAYNOW: "paynow",
  BANK: "bank",
};

export const WITHDRAWAL_METHODS = {
  BANK: "bank",
  PAYNOW: "paynow",
};

export const PAYMENT_STATUS = {
  PENDING: "pending",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const WITHDRAWAL_STATUS = {
  PENDING: "pending",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
};

export const CORS_ALLOWED_ORIGINS = [
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

export const CORS_DEV_PATTERNS = [
  /^https?:\/\/.*\.ngrok-free\.app$/,
  /^https?:\/\/.*\.ngrok\.io$/,
  /^https?:\/\/.*\.loca\.lt$/,
  /^https?:\/\/.*\.trycloudflare\.com$/,
  /^https?:\/\/[0-9a-f-]+\.loca\.lt$/,
];
