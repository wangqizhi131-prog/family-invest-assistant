CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  real_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(real_name, phone)
);

CREATE TABLE IF NOT EXISTS holdings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  market TEXT NOT NULL,
  name TEXT NOT NULL,
  theme TEXT DEFAULT '',
  note TEXT DEFAULT '',
  cost REAL DEFAULT 0,
  shares REAL DEFAULT 0,
  target_weight REAL DEFAULT 0,
  risk TEXT DEFAULT '均衡',
  plan_amount REAL DEFAULT 0,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS watchlist (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  code TEXT NOT NULL,
  market TEXT NOT NULL,
  name TEXT NOT NULL,
  theme TEXT DEFAULT '',
  note TEXT DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  notes TEXT DEFAULT '',
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
