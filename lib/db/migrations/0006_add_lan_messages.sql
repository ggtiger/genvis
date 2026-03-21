-- LAN Messages table for peer chat (separate from project messages)
CREATE TABLE IF NOT EXISTS lan_messages (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  role TEXT NOT NULL,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  sender_id TEXT,
  sender_name TEXT,
  interaction_mode TEXT,
  metadata_json TEXT,
  session_id TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lan_messages_group_id ON lan_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_lan_messages_created_at ON lan_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_lan_messages_session_id ON lan_messages(session_id);
