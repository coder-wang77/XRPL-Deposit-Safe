import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new sqlite3.Database(path.join(__dirname, "data.db"));

db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);

// Per-user UI settings (including custom default XRPL address)
db.run(`
  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER PRIMARY KEY,
    email_notifications INTEGER DEFAULT 1,
    transaction_alerts INTEGER DEFAULT 1,
    network TEXT DEFAULT 'testnet',
    default_xrpl_address TEXT,
    default_xrpl_verified INTEGER DEFAULT 0,
    default_xrpl_verified_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// Best-effort migrations for existing databases
db.run(`ALTER TABLE user_settings ADD COLUMN default_xrpl_verified INTEGER DEFAULT 0`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.warn("Could not add default_xrpl_verified column:", err.message);
  }
});
db.run(`ALTER TABLE user_settings ADD COLUMN default_xrpl_verified_at DATETIME`, (err) => {
  if (err && !err.message.includes("duplicate column")) {
    console.warn("Could not add default_xrpl_verified_at column:", err.message);
  }
});

// Payments table
db.run(`
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount_xlusd REAL NOT NULL,
    amount_usd REAL NOT NULL,
    payment_method TEXT NOT NULL,
    payment_id TEXT UNIQUE,
    status TEXT DEFAULT 'pending',
    tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// User-to-user transfers (XRP / XLUSD)
db.run(`
  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_user_id INTEGER NOT NULL,
    to_user_id INTEGER,
    to_address TEXT NOT NULL,
    currency TEXT NOT NULL, -- 'XRP' or 'XLUSD'
    amount REAL NOT NULL,
    issuer TEXT,
    memo TEXT,
    status TEXT DEFAULT 'pending',
    tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_user_id) REFERENCES users(id),
    FOREIGN KEY (to_user_id) REFERENCES users(id)
  )
`);

// Withdrawals table
db.run(`
  CREATE TABLE IF NOT EXISTS withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    amount_xlusd REAL NOT NULL,
    amount_usd REAL NOT NULL,
    withdrawal_method TEXT NOT NULL,
    account_details TEXT,
    status TEXT DEFAULT 'pending',
    tx_hash TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Fake bank ledger (USD in/out)
db.run(`
  CREATE TABLE IF NOT EXISTS bank_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    direction TEXT NOT NULL, -- 'in' (deposit) or 'out' (payout)
    amount_usd REAL NOT NULL,
    reference TEXT,
    status TEXT DEFAULT 'completed', -- 'pending' | 'completed' | 'failed'
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )
`);

// Fake bank account details (virtual account per user)
db.run(`
  CREATE TABLE IF NOT EXISTS bank_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    bank_name TEXT DEFAULT 'DepositSafe Bank (Simulated)',
    account_number TEXT NOT NULL,
    routing_number TEXT NOT NULL,
    currency TEXT DEFAULT 'USD',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// User wallets table - stores encrypted wallet seeds
db.run(`
  CREATE TABLE IF NOT EXISTS user_wallets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE,
    wallet_address TEXT NOT NULL,
    encrypted_seed TEXT NOT NULL,
    is_verified INTEGER DEFAULT 0,
    verified_at DATETIME,
    simulated_balance_xrp REAL DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);

// Add simulated_balance_xrp column if it doesn't exist (for existing databases)
db.run(`ALTER TABLE user_wallets ADD COLUMN simulated_balance_xrp REAL DEFAULT 0`, (err) => {
  // Ignore error if column already exists
  if (err && !err.message.includes('duplicate column')) {
    console.warn("Could not add simulated_balance_xrp column:", err.message);
  }
});

export default db;
