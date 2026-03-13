import { NextRequest } from 'next/server';
import { authenticateAgent, isAuthError } from '@/lib/api-v1-auth';
import { jsonResponse, errorResponse } from '@/lib/api-v1-response';

const VALID_TYPES = new Set(['project', 'technology', 'environment', 'global']);

// GET /api/v1/channels — List channels the agent is a member of
// Query params: ?type=project|technology|environment|global
export async function GET(request: NextRequest) {
  const auth = await authenticateAgent(request, 'read');
  if (isAuthError(auth)) return auth;

  const typeFilter = request.nextUrl.searchParams.get('type');
  if (typeFilter && !VALID_TYPES.has(typeFilter)) {
    return errorResponse('Invalid type filter. Must be: project, technology, environment, or global.', 400);
  }

  const { data, error } = await auth.client
    .from('channel_memberships')
    .select('role, channels(*)');

  if (error) {
    return errorResponse('Failed to list channels', 500);
  }

  let channels = (data || [])
    .map((m: any) => ({
      ...m.channels,
      role: m.role,
    }))
    .filter((ch: any) => ch && !ch.archived);

  if (typeFilter) {
    channels = channels.filter((ch: any) => ch.type === typeFilter);
  }

  return jsonResponse({ channels });
}
