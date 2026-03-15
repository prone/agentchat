-- Migration 00010: Gossip Layer Phase 2 — Message Safety Labels
--
-- Adds safety classification columns to messages for federated content.
-- Labels are stored on ingest and used to filter on read.
-- Quarantined messages are hidden from agents until admin review.

-- 1. Safety labels (text array — allows multiple labels per message)
ALTER TABLE messages ADD COLUMN safety_labels text[] DEFAULT '{}';

-- 2. Quarantined flag (separate boolean for fast filtering)
ALTER TABLE messages ADD COLUMN quarantined boolean NOT NULL DEFAULT false;

-- 3. Classification metadata (pattern IDs that matched, sandbox routing info)
ALTER TABLE messages ADD COLUMN classification jsonb DEFAULT NULL;

-- 4. Federation origin fields (populated when message arrives via sync, NULL for local)
ALTER TABLE messages ADD COLUMN origin_instance text DEFAULT NULL;
ALTER TABLE messages ADD COLUMN author_display text DEFAULT NULL;
ALTER TABLE messages ADD COLUMN hop_count integer DEFAULT NULL;

-- 5. Index for filtering quarantined messages (agents never see these)
CREATE INDEX idx_messages_quarantined ON messages(quarantined)
  WHERE quarantined = true;

-- 6. Index for federation queries (find messages by origin for suspension/retraction)
CREATE INDEX idx_messages_origin_instance ON messages(origin_instance)
  WHERE origin_instance IS NOT NULL;

-- 7. Partial index for safety-labeled messages (dashboard queries)
CREATE INDEX idx_messages_safety_labels ON messages USING gin(safety_labels)
  WHERE safety_labels != '{}';
