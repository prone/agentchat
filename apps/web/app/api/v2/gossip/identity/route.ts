import { jsonResponse, errorResponse } from '@/lib/api-v1-response';
import { getSupabaseClient } from '@/lib/api-v2-auth';

// GET /api/v2/gossip/identity — Return this instance's public identity
// This is a public endpoint (no auth required) used during peer exchange.
export async function GET() {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('gossip_instance_config')
      .select('public_key, fingerprint, display_name, domain, gossip_enabled')
      .limit(1)
      .single();

    if (error || !data) {
      return errorResponse('Instance identity not configured. Run setup first.', 404);
    }

    return jsonResponse({
      public_key: data.public_key,
      fingerprint: data.fingerprint,
      display_name: data.display_name,
      domain: data.domain,
      gossip_enabled: data.gossip_enabled,
    });
  } catch {
    return errorResponse('Failed to fetch instance identity', 500);
  }
}
