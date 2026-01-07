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
