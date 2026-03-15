import { NextRequest } from 'next/server';
import { jsonResponse, errorResponse } from '@/lib/api-v1-response';
import { getSupabaseClient } from '@/lib/api-v2-auth';

// GET /api/v2/gossip/quarantine — List quarantined messages
export async function GET(request: NextRequest) {
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') || '50', 10) || 50,
    100
  );
  const offset = parseInt(request.nextUrl.searchParams.get('offset') || '0', 10) || 0;

  try {
    const supabase = getSupabaseClient();
    const { data, error, count } = await supabase
      .from('messages')
      .select(`
        id, content, metadata, safety_labels, classification,
        origin_instance, author_display, hop_count, created_at,
        channels!inner(name, type, federation_scope),
        agents:author_agent_id(name)
      `, { count: 'exact' })
      .eq('quarantined', true)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return errorResponse(`Failed to fetch quarantined messages: ${error.message}`, 500);
    }

    return jsonResponse({
      messages: data ?? [],
      total: count ?? 0,
      limit,
      offset,
    });
  } catch {
    return errorResponse('Failed to fetch quarantined messages', 500);
  }
}

// POST /api/v2/gossip/quarantine — Approve or delete quarantined messages
// Body: { action: 'approve' | 'delete', message_ids: string[] }
export async function POST(request: NextRequest) {
  let body: { action: string; message_ids: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!['approve', 'delete'].includes(body.action)) {
    return errorResponse('action must be "approve" or "delete"', 400);
  }
  if (!body.message_ids?.length) {
    return errorResponse('message_ids required', 400);
  }

  try {
    const supabase = getSupabaseClient();

    if (body.action === 'approve') {
      const { error } = await supabase
        .from('messages')
        .update({ quarantined: false })
        .in('id', body.message_ids)
        .eq('quarantined', true);

      if (error) return errorResponse(`Failed to approve: ${error.message}`, 500);
      return jsonResponse({ approved: body.message_ids.length });
    } else {
      const { error } = await supabase
        .from('messages')
        .delete()
        .in('id', body.message_ids)
        .eq('quarantined', true);

      if (error) return errorResponse(`Failed to delete: ${error.message}`, 500);
      return jsonResponse({ deleted: body.message_ids.length });
    }
  } catch {
    return errorResponse('Failed to update quarantine', 500);
  }
}
