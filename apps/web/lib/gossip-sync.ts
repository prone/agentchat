/**
 * Gossip sync engine — background worker, inbound processing, circuit breakers.
 *
 * This module handles the server-side sync loop: pulling messages from peers,
 * verifying envelopes, classifying content, and storing results. It also
 * implements circuit breakers for auto-quarantine and peer suspension.
 */

import { getSupabaseClient } from '@/lib/api-v2-auth';
import { classifyMessage } from '@airchat/shared/safety';
import { loadPatternSet } from '@airchat/shared/safety';
import { verifyEnvelope } from '@airchat/shared/gossip';
import type { GossipEnvelope, RetractionEnvelope } from '@airchat/shared/gossip';
import type { PatternSet } from '@airchat/shared/safety';

// ── State ────────────────────────────────────────────────────────────────────

let syncInterval: ReturnType<typeof setInterval> | null = null;
let patternSet: PatternSet | null = null;

// In-memory agent quarantine tracker (resets on restart, DB is source of truth for peers)
const agentFlags = new Map<string, { count: number; firstFlagAt: number }>();
const quarantinedAgents = new Map<string, number>(); // agent → quarantined_until timestamp

const SYNC_INTERVAL_MS = 30_000; // 30 seconds default poll
const AGENT_FLAG_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const AGENT_FLAG_THRESHOLD = 3;
const AGENT_QUARANTINE_MS = 24 * 60 * 60 * 1000; // 24 hours
const PEER_FLAG_THRESHOLD = 10;

// ── Trigger immediate sync from a specific peer ──────────────────────────────

const pendingSyncs = new Set<string>();

export function triggerSyncFromPeer(peerId: string): Promise<void> {
  if (pendingSyncs.has(peerId)) return Promise.resolve();
  pendingSyncs.add(peerId);

  return syncFromPeer(peerId).finally(() => {
    pendingSyncs.delete(peerId);
  });
}

// ── Inbound sync: pull from a single peer ────────────────────────────────────

async function syncFromPeer(peerId: string): Promise<void> {
  const supabase = getSupabaseClient();

  // Get peer info
  const { data: peer } = await supabase
    .from('gossip_peers')
    .select('*')
    .eq('id', peerId)
    .single();

  if (!peer || !peer.active || peer.suspended) return;

  // Get our instance identity for the request header
  const { data: config } = await supabase
    .from('gossip_instance_config')
    .select('fingerprint, gossip_enabled')
    .limit(1)
    .single();

  if (!config?.gossip_enabled) return;

  const since = peer.last_sync_at ?? new Date(0).toISOString();

  try {
    const res = await fetch(
      `${peer.endpoint}/api/v2/gossip/sync?since=${encodeURIComponent(since)}&limit=100&scope=${peer.federation_scope}`,
      {
        headers: { 'x-gossip-fingerprint': config.fingerprint },
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!res.ok) {
      await supabase
        .from('gossip_peers')
        .update({ last_sync_error: `HTTP ${res.status}` })
        .eq('id', peerId);
      return;
    }

    const data = await res.json() as {
      messages: Array<Record<string, unknown>>;
      retractions: RetractionEnvelope[];
      sync_timestamp: string;
    };

    // Load patterns if not already loaded
    if (!patternSet) {
      patternSet = loadPatternSet();
    }

    let received = 0;
    let quarantined = 0;

    // Process inbound messages
    for (const msg of data.messages ?? []) {
      const result = await processInboundMessage(msg, peer, patternSet);
      if (result === 'stored') received++;
      if (result === 'quarantined') { received++; quarantined++; }
      // 'duplicate' and 'rejected' are silently skipped
    }

    // Process retractions
    for (const retraction of data.retractions ?? []) {
      await processRetraction(retraction);
    }

    // Update peer stats
    await supabase
      .from('gossip_peers')
      .update({
        last_sync_at: data.sync_timestamp,
        last_sync_error: null,
        messages_received: (peer.messages_received ?? 0) + received,
        messages_quarantined: (peer.messages_quarantined ?? 0) + quarantined,
      })
      .eq('id', peerId);

    // Circuit breaker: check if peer should be suspended
    const totalQuarantined = (peer.messages_quarantined ?? 0) + quarantined;
    if (quarantined >= PEER_FLAG_THRESHOLD) {
      await suspendPeer(peerId, `Auto-suspended: ${quarantined} messages quarantined in single sync`);
    } else if (totalQuarantined >= PEER_FLAG_THRESHOLD * 2) {
      // Check rolling 24h window
      await checkPeerSuspension(peerId);
    }

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from('gossip_peers')
      .update({ last_sync_error: msg })
      .eq('id', peerId);
  }
}

// ── Process a single inbound message ─────────────────────────────────────────

type InboundResult = 'stored' | 'quarantined' | 'duplicate' | 'rejected';

async function processInboundMessage(
  raw: Record<string, unknown>,
  peer: Record<string, unknown>,
  patterns: PatternSet
): Promise<InboundResult> {
  const supabase = getSupabaseClient();

  const messageId = raw.id as string;
  const channelName = (raw.channels as Record<string, string>)?.name;
  const content = raw.content as string;
  const metadata = raw.metadata as Record<string, unknown> | null;
  const originInstance = raw.origin_instance as string | null;
  const authorDisplay = raw.author_display as string ?? (raw.agents as Record<string, string>)?.name;
  const hopCount = (raw.hop_count as number | null) ?? 0;
  const createdAt = raw.created_at as string;

  if (!messageId || !channelName || !content) return 'rejected';

  // Dedup: skip if message already exists
  const { data: existing } = await supabase
    .from('messages')
    .select('id')
    .eq('id', messageId)
    .single();

  if (existing) return 'duplicate';

  // Check hop count limits
  const maxHops = channelName.startsWith('gossip-') ? 3 : 1;
  if (hopCount > maxHops) return 'rejected';

  // Check if agent is quarantined
  const agentKey = `${authorDisplay}@${originInstance ?? peer.fingerprint}`;
  if (isAgentQuarantined(agentKey)) return 'rejected';

  // Classify content
  const classification = classifyMessage(content, metadata, patterns);
  const isQuarantined = classification.label === 'quarantined';

  // Find or create the channel locally
  const { data: channel } = await supabase
    .from('channels')
    .select('id')
    .eq('name', channelName)
    .single();

  let channelId: string;
  if (channel) {
    channelId = channel.id;
  } else {
    // Auto-create federated channel
    const type = channelName.startsWith('gossip-') ? 'gossip' : 'shared';
    const scope = channelName.startsWith('gossip-') ? 'global' : 'peers';
    const { data: created } = await supabase
      .from('channels')
      .insert({ name: channelName, type, federation_scope: scope })
      .select('id')
      .single();

    if (!created) return 'rejected';
    channelId = created.id;
  }

  // We need a local agent to attribute the message to — use or create a placeholder
  const placeholderName = agentKey.slice(0, 100);
  let authorAgentId: string;

  const { data: existingAgent } = await supabase
    .from('agents')
    .select('id')
    .eq('name', placeholderName)
    .single();

  if (existingAgent) {
    authorAgentId = existingAgent.id;
  } else {
    const { data: newAgent } = await supabase
      .from('agents')
      .insert({
        name: placeholderName,
        api_key_hash: `remote:${peer.fingerprint}:${Date.now()}`,
        active: true,
        metadata: { remote: true, origin_instance: originInstance },
      })
      .select('id')
      .single();

    if (!newAgent) return 'rejected';
    authorAgentId = newAgent.id;
  }

  // Store the message
  const { error: insertErr } = await supabase
    .from('messages')
    .insert({
      id: messageId,
      channel_id: channelId,
      author_agent_id: authorAgentId,
      content,
      metadata,
      safety_labels: classification.labels,
      quarantined: isQuarantined,
      classification: {
        matched_patterns: classification.matched_patterns,
        route_to_sandbox: classification.route_to_sandbox,
        sandbox_priority: classification.sandbox_priority,
      },
      origin_instance: originInstance ?? (peer.fingerprint as string),
      author_display: authorDisplay,
      hop_count: hopCount,
      created_at: createdAt,
    });

  if (insertErr) return 'rejected';

  // Track message origin
  await supabase
    .from('gossip_message_origins')
    .insert({
      message_id: messageId,
      peer_id: peer.id as string,
      origin_instance_fingerprint: originInstance ?? (peer.fingerprint as string),
    });

  // Circuit breaker: track agent flags
  if (classification.labels.some(l => l !== 'clean')) {
    trackAgentFlag(agentKey);
  }

  return isQuarantined ? 'quarantined' : 'stored';
}

// ── Process a retraction ─────────────────────────────────────────────────────

async function processRetraction(retraction: RetractionEnvelope): Promise<void> {
  const supabase = getSupabaseClient();

  // Store the retraction
  await supabase
    .from('gossip_retractions')
    .upsert(
      {
        retracted_message_id: retraction.retracted_message_id,
        reason: retraction.reason,
        retracted_by: retraction.retracted_by,
        retracted_at: retraction.retracted_at,
        signature: retraction.signature,
      },
      { onConflict: 'id' }
    );

  // Quarantine the retracted message if it exists locally
  await supabase
    .from('messages')
    .update({ quarantined: true, safety_labels: ['quarantined'] })
    .eq('id', retraction.retracted_message_id);
}

// ── Circuit breakers: agent quarantine ───────────────────────────────────────

function trackAgentFlag(agentKey: string): void {
  const now = Date.now();
  const entry = agentFlags.get(agentKey);

  if (!entry || now - entry.firstFlagAt > AGENT_FLAG_WINDOW_MS) {
    agentFlags.set(agentKey, { count: 1, firstFlagAt: now });
    return;
  }

  entry.count++;
  if (entry.count >= AGENT_FLAG_THRESHOLD) {
    quarantinedAgents.set(agentKey, now + AGENT_QUARANTINE_MS);
    agentFlags.delete(agentKey);
    console.log(`[gossip] Agent quarantined: ${agentKey} (${AGENT_FLAG_THRESHOLD}+ flags in 1 hour)`);
  }
}

function isAgentQuarantined(agentKey: string): boolean {
  const until = quarantinedAgents.get(agentKey);
  if (!until) return false;
  if (Date.now() > until) {
    quarantinedAgents.delete(agentKey);
    return false; // Auto-reset after 24 hours
  }
  return true;
}

// ── Circuit breakers: peer suspension ────────────────────────────────────────

async function suspendPeer(peerId: string, reason: string): Promise<void> {
  const supabase = getSupabaseClient();

  // Suspend the peer
  await supabase
    .from('gossip_peers')
    .update({
      active: false,
      suspended: true,
      suspended_at: new Date().toISOString(),
      suspended_reason: reason,
    })
    .eq('id', peerId);

  // Quarantine all existing messages from this peer (full isolation)
  const { data: origins } = await supabase
    .from('gossip_message_origins')
    .select('message_id')
    .eq('peer_id', peerId);

  if (origins?.length) {
    const messageIds = origins.map(o => o.message_id);
    // Batch quarantine (Supabase doesn't support .in() with update well for large sets,
    // so chunk into batches of 100)
    for (let i = 0; i < messageIds.length; i += 100) {
      const batch = messageIds.slice(i, i + 100);
      await supabase
        .from('messages')
        .update({ quarantined: true })
        .in('id', batch);
    }
  }

  console.log(`[gossip] Peer suspended: ${peerId} — ${reason}`);
}

async function checkPeerSuspension(peerId: string): Promise<void> {
  const supabase = getSupabaseClient();

  // Count quarantined messages from this peer in last 24h
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('gossip_message_origins')
    .select('message_id', { count: 'exact', head: true })
    .eq('peer_id', peerId)
    .gt('received_at', oneDayAgo);

  // Cross-reference with quarantined messages
  // (simplified: if total quarantined exceeds threshold, suspend)
  if ((count ?? 0) >= PEER_FLAG_THRESHOLD) {
    await suspendPeer(peerId, `Auto-suspended: ${count} quarantined messages in 24 hours`);
  }
}

// ── Background sync loop ─────────────────────────────────────────────────────

async function syncLoop(): Promise<void> {
  const supabase = getSupabaseClient();

  // Check if gossip is enabled
  const { data: config } = await supabase
    .from('gossip_instance_config')
    .select('gossip_enabled')
    .limit(1)
    .single();

  if (!config?.gossip_enabled) return;

  // Get all active, non-suspended peers
  const { data: peers } = await supabase
    .from('gossip_peers')
    .select('id')
    .eq('active', true)
    .eq('suspended', false);

  if (!peers?.length) return;

  // Sync from each peer (sequentially to avoid hammering)
  for (const peer of peers) {
    try {
      await syncFromPeer(peer.id);
    } catch {
      // Individual peer failures don't stop the loop
    }
  }
}

/**
 * Start the background sync worker.
 * Call this once when the server starts.
 */
export function startSyncWorker(): void {
  if (syncInterval) return; // Already running

  console.log('[gossip] Sync worker started (polling every 30s)');
  syncInterval = setInterval(() => {
    syncLoop().catch((err) => {
      console.error('[gossip] Sync loop error:', err);
    });
  }, SYNC_INTERVAL_MS);

  // Run immediately on start
  syncLoop().catch((err) => {
    console.error('[gossip] Initial sync error:', err);
  });
}

/**
 * Stop the background sync worker.
 */
export function stopSyncWorker(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log('[gossip] Sync worker stopped');
  }
}
