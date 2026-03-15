import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/api-v1-response';
import { getSupabaseClient } from '@/lib/api-v2-auth';
import { triggerSyncFromPeer } from '@/lib/gossip-sync';

/**
 * POST /api/v2/gossip/notify — Push notification from a peer.
 *
 * A peer calls this to say "I have new messages for you."
 * This triggers an immediate sync pull from the notifying peer
 * instead of waiting for the next poll interval.
 *
 * Body: { fingerprint: string, message_count?: number }
 */
export async function POST(request: NextRequest) {
  let body: { fingerprint: string; message_count?: number };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!body.fingerprint) {
    return errorResponse('fingerprint required', 400);
  }

  const supabase = getSupabaseClient();

  // Verify peer
  const { data: peer } = await supabase
    .from('gossip_peers')
    .select('id, endpoint, active, suspended')
    .eq('fingerprint', body.fingerprint)
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
    return errorResponse('Gossip is disabled', 503);
  }

  // Trigger immediate sync from this peer (async, don't block the response)
  triggerSyncFromPeer(peer.id).catch(() => {
    // Sync errors are logged internally, don't fail the notification
  });

  return jsonResponse({ acknowledged: true });
}
