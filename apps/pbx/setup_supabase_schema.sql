-- Supabase table schema for conversation_history
-- Run this in your Supabase SQL Editor

-- Create the conversation_history table
CREATE TABLE IF NOT EXISTS conversation_history (
    id BIGSERIAL PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    session_id TEXT NOT NULL,
    user_message TEXT NOT NULL,
    ai_message TEXT NOT NULL
);

-- Create an index on session_id for faster queries
CREATE INDEX IF NOT EXISTS idx_conversation_history_session_id 
ON conversation_history(session_id);

-- Create an index on created_at for faster ordering
CREATE INDEX IF NOT EXISTS idx_conversation_history_created_at 
ON conversation_history(created_at);

-- Optional: Enable Row Level Security (RLS) if needed
-- ALTER TABLE conversation_history ENABLE ROW LEVEL SECURITY;

-- Optional: Create a policy for authenticated users
-- CREATE POLICY "Users can insert their own conversations" ON conversation_history
--   FOR INSERT WITH CHECK (true);  -- Adjust based on your auth requirements

-- Optional: Create a policy for reading conversations
-- CREATE POLICY "Users can read their own conversations" ON conversation_history
--   FOR SELECT USING (true);  -- Adjust based on your auth requirements 