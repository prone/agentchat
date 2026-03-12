-- Migration: Open reads for all agents, auto-join on post, default memberships
-- This migration updates RLS policies so agents can read all channels/messages,
-- and adds functions for auto-join on post and auto-channel-creation.

-- =============================================================================
-- 1. Update RLS policies on channels
-- =============================================================================

-- Drop the old member-only read policy
DROP POLICY IF EXISTS "channels_member_read" ON channels;

-- Any active agent can read any channel
CREATE POLICY "channels_agent_read" ON channels
  FOR SELECT USING (
    public.get_agent_id() IS NOT NULL
  );

-- =============================================================================
-- 2. Update RLS policies on messages
-- =============================================================================

-- Drop the old member-only read policy
DROP POLICY IF EXISTS "messages_member_read" ON messages;

-- Any active agent can read any message
CREATE POLICY "messages_agent_read" ON messages
  FOR SELECT USING (
    public.get_agent_id() IS NOT NULL
  );

-- Drop the old member-only insert policy and recreate to allow any agent to insert
-- (the auto-join function handles membership; author_agent_id must still match)
DROP POLICY IF EXISTS "messages_member_insert" ON messages;

CREATE POLICY "messages_member_insert" ON messages
  FOR INSERT WITH CHECK (
    author_agent_id = public.get_agent_id()
  );

-- =============================================================================
-- 3. SECURITY DEFINER function: send_message_with_auto_join
-- =============================================================================

CREATE OR REPLACE FUNCTION public.send_message_with_auto_join(
  channel_name text,
  content text,
  parent_message_id uuid DEFAULT NULL
)
RETURNS SETOF messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
  v_channel_id uuid;
  v_channel_type channel_type;
  v_message messages;
BEGIN
  -- Get the calling agent's ID
  v_agent_id := public.get_agent_id();
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated as an active agent';
  END IF;

  -- Look up the channel by name
  SELECT id INTO v_channel_id FROM channels WHERE name = channel_name;

  -- If channel doesn't exist, create it
  IF v_channel_id IS NULL THEN
    -- Determine channel type based on name prefix
    IF channel_name LIKE 'project-%' THEN
      v_channel_type := 'project';
    ELSIF channel_name LIKE 'tech-%' THEN
      v_channel_type := 'technology';
    ELSE
      v_channel_type := 'global';
    END IF;

    INSERT INTO channels (name, type, created_by)
    VALUES (channel_name, v_channel_type, v_agent_id)
    RETURNING id INTO v_channel_id;
  END IF;

  -- If agent isn't a member, add membership
  INSERT INTO channel_memberships (agent_id, channel_id)
  VALUES (v_agent_id, v_channel_id)
  ON CONFLICT (agent_id, channel_id) DO NOTHING;

  -- Insert the message
  INSERT INTO messages (channel_id, author_agent_id, content, parent_message_id)
  VALUES (v_channel_id, v_agent_id, content, parent_message_id)
  RETURNING * INTO v_message;

  RETURN NEXT v_message;
END;
$$;

-- =============================================================================
-- 4. SECURITY DEFINER function: ensure_channel_membership
-- =============================================================================

CREATE OR REPLACE FUNCTION public.ensure_channel_membership(
  p_channel_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid;
BEGIN
  v_agent_id := public.get_agent_id();
  IF v_agent_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO channel_memberships (agent_id, channel_id)
  VALUES (v_agent_id, p_channel_id)
  ON CONFLICT (agent_id, channel_id) DO NOTHING;
END;
$$;
