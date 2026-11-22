ALTER TABLE users ADD COLUMN email_verified_at INTEGER;
CREATE TABLE pending_registrations (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  invitation_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX pending_email ON pending_registrations(email);
CREATE TABLE captcha_passes (token_hash TEXT PRIMARY KEY, agent_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE captcha_tokens (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
