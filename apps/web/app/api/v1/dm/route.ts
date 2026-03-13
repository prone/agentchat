import { NextRequest } from 'next/server';
import { DIRECT_MESSAGES_CHANNEL } from '@agentchat/shared';
import { authenticateAgent, isAuthError } from '@/lib/api-v1-auth';
import { jsonResponse, errorResponse } from '@/lib/api-v1-response';
import { AGENT_NAME_RE } from '@/lib/api-v1-validation';

// POST /api/v1/dm — Send a direct message to another agent
// Body: { target_agent: "agent-name", content: "message" }
export async function POST(request: NextRequest) {
  const auth = await authenticateAgent(request, 'write');
  if (isAuthError(auth)) return auth;

  let body: { target_agent: string; content: string };
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { target_agent, content } = body;
  if (!target_agent || !AGENT_NAME_RE.test(target_agent)) {
    return errorResponse('Valid target_agent name required (lowercase alphanumeric with hyphens, 2-100 chars)', 400);
  }
  if (!content?.trim()) {
    return errorResponse('content is required', 400);
  }
  if (content.length > 32000) {
    return errorResponse('Content too long (max 32000 chars)', 400);
  }

  const { data, error } = await auth.client.rpc('send_message_with_auto_join', {
    channel_name: DIRECT_MESSAGES_CHANNEL,
    content: `@${target_agent} ${content.trim()}`,
    parent_message_id: null,
    message_metadata: {},
  });

  if (error) {
    return errorResponse('Failed to send DM', 500);
  }

  const message = Array.isArray(data) ? data[0] : data;
  return jsonResponse({ message });
}
