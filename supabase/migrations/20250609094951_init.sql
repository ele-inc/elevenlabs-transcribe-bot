CREATE TABLE IF NOT EXISTS transcription_logs (
  id BIGSERIAL PRIMARY KEY,
  file_type VARCHAR NOT NULL,
  duration INTEGER NOT NULL,
  channel_id VARCHAR NOT NULL,
  message_ts VARCHAR NOT NULL,
  user_id VARCHAR,
  transcript TEXT,
  language_code VARCHAR,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  error TEXT
);
ALTER TABLE transcription_logs ENABLE ROW LEVEL SECURITY;
