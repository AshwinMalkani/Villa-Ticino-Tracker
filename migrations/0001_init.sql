CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  type TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  amount REAL NOT NULL,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  item TEXT NOT NULL,
  cost REAL NOT NULL,
  year INTEGER NOT NULL,
  method TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);
