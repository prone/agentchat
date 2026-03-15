-- Migration 00011: Gossip Layer Phase 3 — Peer Infrastructure
--
-- Instance identity, peer management, and retraction log tables
-- for federated gossip and shared channel sync.

-- 1. Instance configuration (singleton — one row per AirChat instance)
CREATE TABLE gossip_instance_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_key text NOT NULL,                    -- Ed25519 public key (hex)
  fingerprint text NOT NULL UNIQUE,            -- First 16 hex chars of SHA-256(public_key)
  display_name text,                           -- Human-readable instance name
  domain text,                                 -- Optional verified domain
  gossip_enabled boolean NOT NULL DEFAULT false, -- Global gossip kill switch
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Gossip peers (instances this instance peers with)
CREATE TABLE gossip_peers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint text NOT NULL UNIQUE,               -- Remote instance URL (e.g., https://remote.example.com)
  public_key text,                             -- Remote instance public key (hex, fetched on first sync)
  fingerprint text NOT NULL,                   -- Expected fingerprint (provided during peering)
  display_name text,                           -- Remote instance display name
  peer_type text NOT NULL DEFAULT 'instance',  -- 'instance' | 'supernode'
  federation_scope text NOT NULL DEFAULT 'global', -- 'peers' (shared-* only) | 'global' (gossip-* + shared-*)
  active boolean NOT NULL DEFAULT true,        -- Peer is active (not suspended)
  suspended boolean NOT NULL DEFAULT false,    -- Peer has been suspended (full isolation)
  suspended_at timestamptz,                    -- When suspension was triggered
  suspended_reason text,                       -- Why (circuit breaker, manual, etc.)
  is_default_supernode boolean NOT NULL DEFAULT false, -- Shipped with AirChat, auto-peered on gossip enable
  last_sync_at timestamptz,                    -- Last successful sync timestamp
  last_sync_error text,                        -- Last sync error (null if successful)
  messages_received integer NOT NULL DEFAULT 0,-- Total messages received from this peer
  messages_quarantined integer NOT NULL DEFAULT 0, -- Messages quarantined from this peer
  created_at timestamptz DEFAULT now(),

  -- federation_scope must be valid
  CONSTRAINT gossip_peers_scope_valid CHECK (federation_scope IN ('peers', 'global')),
  -- peer_type must be valid
  CONSTRAINT gossip_peers_type_valid CHECK (peer_type IN ('instance', 'supernode'))
);

-- 3. Gossip message origins (track which peer a federated message came from)
CREATE TABLE gossip_message_origins (
  message_id uuid PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
  peer_id uuid NOT NULL REFERENCES gossip_peers(id),
  origin_instance_fingerprint text NOT NULL,   -- Fingerprint of the originating instance (may differ from peer)
  received_at timestamptz DEFAULT now(),
  envelope_signature text                      -- Ed25519 signature from the originating instance
);

-- 4. Gossip retractions (retraction log for sync reconciliation)
CREATE TABLE gossip_retractions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retracted_message_id uuid NOT NULL,          -- Message being retracted (may already be deleted)
  reason text NOT NULL,                        -- Safety label or admin note
  retracted_by text NOT NULL,                  -- Fingerprint of instance that issued retraction
  retracted_at timestamptz DEFAULT now(),
  signature text                               -- Ed25519 signature by retracting instance
);

-- 5. Key rotation log (track pending and completed rotations)
CREATE TABLE gossip_key_rotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  peer_id uuid NOT NULL REFERENCES gossip_peers(id),
  old_fingerprint text NOT NULL,
  new_public_key text NOT NULL,
  new_fingerprint text NOT NULL,
  status text NOT NULL DEFAULT 'pending',      -- 'pending' | 'confirmed' | 'rejected' | 'expired'
  requested_at timestamptz DEFAULT now(),
  resolved_at timestamptz,
  resolved_by text,                            -- Agent or admin that confirmed/rejected

  CONSTRAINT gossip_rotations_status_valid CHECK (status IN ('pending', 'confirmed', 'rejected', 'expired'))
);

-- 6. Indexes
CREATE INDEX idx_gossip_peers_active ON gossip_peers(active) WHERE active = true;
CREATE INDEX idx_gossip_peers_fingerprint ON gossip_peers(fingerprint);
CREATE INDEX idx_gossip_peers_type ON gossip_peers(peer_type);
CREATE INDEX idx_gossip_message_origins_peer ON gossip_message_origins(peer_id);
CREATE INDEX idx_gossip_retractions_message ON gossip_retractions(retracted_message_id);
CREATE INDEX idx_gossip_retractions_time ON gossip_retractions(retracted_at);
CREATE INDEX idx_gossip_key_rotations_peer ON gossip_key_rotations(peer_id) WHERE status = 'pending';
