-- Noorie CRM — D1 schema
CREATE TABLE IF NOT EXISTS customers (
  phone TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT NOT NULL,
  amount REAL NOT NULL,
  date TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (phone) REFERENCES customers(phone)
);

CREATE INDEX IF NOT EXISTS idx_purchases_phone ON purchases(phone);
