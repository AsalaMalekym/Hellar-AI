-- All dollar amounts are integer micro-USD (1 USD = 1,000,000 units).
-- No ON DELETE CASCADE: financial history must survive profile deletion.
CREATE TABLE wallets (
 user_id TEXT PRIMARY KEY,
 balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0)
);
CREATE TABLE subscriptions (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL,
 starts_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 remaining INTEGER NOT NULL CHECK(remaining >= 0), granted INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE INDEX subscriptions_user ON subscriptions(user_id, expires_at);
CREATE TABLE payment_orders (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL,
 request_key TEXT NOT NULL, nonce TEXT NOT NULL UNIQUE,
 rub_kopecks INTEGER NOT NULL CHECK(rub_kopecks > 0), credit INTEGER NOT NULL CHECK(credit > 0),
 fx_kopecks INTEGER NOT NULL, merchant TEXT NOT NULL, test INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, paid_at INTEGER,
 UNIQUE(user_id, request_key)
);
CREATE TABLE billing_holds (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL,
 price_json TEXT NOT NULL, subscription_id TEXT,
 package_reserved INTEGER NOT NULL, wallet_reserved INTEGER NOT NULL,
 state TEXT NOT NULL DEFAULT 'reserved', charged INTEGER, provider_cost INTEGER,
 usage_json TEXT, provider_request_id TEXT, note TEXT, created_at INTEGER NOT NULL, settled_at INTEGER
);
CREATE INDEX billing_holds_user ON billing_holds(user_id, state);
CREATE TABLE billing_ledger (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL,
 amount INTEGER NOT NULL, reference TEXT NOT NULL UNIQUE,
 detail TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX billing_ledger_user ON billing_ledger(user_id, created_at);
