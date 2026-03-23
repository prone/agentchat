import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@airchat/shared/supabase';
import { SLACK_BRIDGE_AGENT } from '@airchat/shared';

// Polls for new AirChat messages and forwards them to Slack via Incoming Webhook.
// Called by a cron job every 30-60 seconds.
//
// Forwards messages that:
//   1. Mention @human in their content
//   2. Are posted to channels listed in SLACK_WATCHED_CHANNELS (comma-separated)
//
// Skips messages posted by the slack-bridge agent (prevents echo loops).
//
// Environment variables:
//   SLACK_WEBHOOK_URL       - Slack Incoming Webhook URL
//   SLACK_WATCHED_CHANNELS  - Comma-separated channel names to forward (default: "human-messages")
//   SLACK_FORWARD_SECRET    - Shared secret to authenticate cron requests

let _lastPollTime: string | null = null;

export async function POST(request: NextRequest) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  const forwardSecret = process.env.SLACK_FORWARD_SECRET;

  if (!webhookUrl) {
    return NextResponse.json({ error: 'SLACK_WEBHOOK_URL not configured' }, { status: 500 });
  }

  // Authenticate the cron request
  if (forwardSecret) {
    const auth = request.headers.get('authorization');
    if (auth !== `Bearer ${forwardSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Missing Supabase configuration' }, { status: 500 });
  }

  const watchedChannels = (process.env.SLACK_WATCHED_CHANNELS || 'human-messages')
    .split(',')
    .map(c => c.trim())
    .filter(Boolean);

  const admin = createAdminClient(supabaseUrl, serviceKey);

  // Default to 60 seconds ago on first poll
  const since = _lastPollTime || new Date(Date.now() - 60_000).toISOString();
  const now = new Date().toISOString();

  // Fetch recent messages with channel and author info
  const { data: messages, error } = await admin
    .from('messages')
    .select('id, content, created_at, metadata, channels!inner(name), agents!inner(name)')
    .gt('created_at', since)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: 'Failed to query messages', detail: error.message }, { status: 500 });
  }

  _lastPollTime = now;

  if (!messages || messages.length === 0) {
    return NextResponse.json({ forwarded: 0 });
  }

  let forwarded = 0;

  for (const msg of messages) {
    const channelName = (msg.channels as any)?.name;
    const authorName = (msg.agents as any)?.name;

    // Skip messages from the slack-bridge agent (prevent echo)
    if (authorName === SLACK_BRIDGE_AGENT) continue;

    // Check if this message should be forwarded
    const mentionsHuman = /\b@human\b/i.test(msg.content);
    const inWatchedChannel = watchedChannels.includes(channelName);

    if (!mentionsHuman && !inWatchedChannel) continue;

    // Format and send to Slack
    const prefix = mentionsHuman ? ':rotating_light: ' : '';
    const slackText = `${prefix}*${authorName}* in #${channelName}:\n${msg.content}`;

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: slackText }),
    });

    if (res.ok) forwarded++;
  }

  return NextResponse.json({ forwarded, checked: messages.length });
}
