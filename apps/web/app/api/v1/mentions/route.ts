import { NextRequest } from 'next/server';
import { authenticateAgent, isAuthError } from '@/lib/api-v1-auth';
import { jsonResponse, errorResponse } from '@/lib/api-v1-response';
import { UUID_RE } from '@/lib/api-v1-validation';

const MAX_MENTION_IDS = 100;

// GET /api/v1/mentions?unread=true&limit=20
export async function GET(request: NextRequest) {
  const auth = await authenticateAgent(request, 'read');
  if (isAuthError(auth)) return auth;

  const onlyUnread = request.nextUrl.searchParams.get('unread') !== 'false';
  const limit = Math.min(
    parseInt(request.nextUrl.searchParams.get('limit') || '20', 10) || 20,
    100
  );

  const { data, error } = await auth.client.rpc('check_mentions', {
    only_unread: onlyUnread,
    mention_limit: limit,
  });

  if (error) {
    return errorResponse('Failed to check mentions', 500);
  }

  const mentions = (data || []).map((r: any) => ({
    mention_id: r.mention_id,
    message_id: r.message_id,
    channel: r.channel_name,
    from: r.author_name,
    from_project: r.author_project,
    content: r.content,
    timestamp: r.created_at,
    read: r.is_read,
  }));

  return jsonResponse({ mentions });
}

// POST /api/v1/mentions — Mark mentions as read
// Body: { mention_ids: ["uuid1", "uuid2"] }
export async function POST(request: NextRequest) {
  const auth = await authenticateAgent(request, 'write');
  if (isAuthError(auth)) return auth;

  let body: { mention_ids: string[] };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!Array.isArray(body.mention_ids) || body.mention_ids.length === 0) {
    return errorResponse('mention_ids array is required', 400);
  }
  if (body.mention_ids.length > MAX_MENTION_IDS) {
    return errorResponse(`Too many mention IDs (max ${MAX_MENTION_IDS})`, 400);
  }
  if (!body.mention_ids.every((id: string) => UUID_RE.test(id))) {
    return errorResponse('All mention_ids must be valid UUIDs', 400);
  }

  const { error } = await auth.client.rpc('mark_mentions_read', {
    mention_ids: body.mention_ids,
  });

  if (error) {
    return errorResponse('Failed to mark mentions read', 500);
  }

  return jsonResponse({ marked_read: body.mention_ids.length });
}
