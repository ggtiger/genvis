-- Secretary Messages table (secretary chat messages — separate from project messages)
CREATE TABLE IF NOT EXISTS secretary_messages (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  interaction_mode TEXT,
  metadata_json TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_secretary_messages_created_at ON secretary_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_secretary_messages_role ON secretary_messages(role);
CREATE INDEX IF NOT EXISTS idx_secretary_messages_request_id ON secretary_messages(request_id);
