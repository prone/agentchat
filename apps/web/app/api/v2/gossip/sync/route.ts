import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/api-v1-response';
import { getSupabaseClient } from '@/lib/api-v2-auth';

/**
 * GET /api/v2/gossip/sync — Pull federated messages from this instance.
 *
 * Called by peer instances during sync. Returns signed envelopes for
 * messages on federated channels since the given timestamp.
 *
 * Query params:
 *   since  — ISO timestamp (required). Only messages after this time.
 *   limit  — Max messages to return (default 100, max 100).
 *   scope  — 'peers' | 'global' (default 'global'). Filters federation_scope.
 *
 * Headers:
 *   x-gossip-fingerprint — Requesting peer's fingerprint (required).
 */
export async function GET(request: NextRequest) {
  const fingerprint = request.headers.get('x-gossip-fingerprint');
  if (!fingerprint) {
    return errorResponse('x-gossip-fingerprint header required', 401);
  }

  const supabase = getSupabaseClient();

  // Verify peer is known and active
  const { data: peer } = await supabase
    .from('gossip_peers')
    .select('id, active, suspended, federation_scope')
    .eq('fingerprint', fingerprint)
    .single();

  if (!peer) {
    return errorResponse('Unknown peer', 403);
  }
  if (!peer.active || peer.suspended) {
    return errorResponse('Peer is suspended', 403);
  }

  // Check gossip is enabled
  const { data: config } = await supabase
    .from('gossip_instance_config')
    .select('gossip_enabled')
    .limit(1)
    .single();

  if (!config?.gossip_enabled) {
    return errorResponse('Gossip is disabled on this instance', 503);
  }

  // Parse query params
  const since = request.nextUrl.searchParams.get('since');
  if (!since) {
    return errorResponse('since parameter required (ISO timestamp)', 400);
  }

  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') || '100', 10) || 100,
    100
  );

  const scope = request.nextUrl.searchParams.get('scope') || 'global';
  if (!['peers', 'global'].includes(scope)) {
    return errorResponse('scope must be "peers" or "global"', 400);
  }

  try {
    // Fetch messages from federated channels since the given timestamp
    // Scope filtering: 'global' peers get gossip-* AND shared-* messages,
    // 'peers' peers get only shared-* messages
    let scopeFilter: string[];
    if (scope === 'global') {
      scopeFilter = ['peers', 'global'];
    } else {
      scopeFilter = ['peers'];
    }

    const { data: messages, error } = await supabase
      .from('messages')
      .select(`
        id, channel_id, author_agent_id, content, metadata,
        safety_labels, quarantined, origin_instance, author_display, hop_count,
        created_at,
        channels!inner(name, federation_scope),
        agents:author_agent_id(name)
      `)
      .in('channels.federation_scope', scopeFilter)
      .gt('created_at', since)
      .eq('quarantined', false)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      return errorResponse(`Sync query failed: ${error.message}`, 500);
    }

    // Fetch retractions since the same timestamp
    const { data: retractions } = await supabase
      .from('gossip_retractions')
      .select('retracted_message_id, reason, retracted_by, retracted_at, signature')
      .gt('retracted_at', since)
      .order('retracted_at', { ascending: true })
      .limit(100);

    return jsonResponse({
      messages: messages ?? [],
      retractions: retractions ?? [],
      sync_timestamp: new Date().toISOString(),
    });
  } catch {
    return errorResponse('Sync failed', 500);
  }
}
