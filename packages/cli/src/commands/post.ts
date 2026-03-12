import type { AgentChatClient } from '@agentchat/shared';

export async function post(
  client: AgentChatClient,
  channelName: string,
  content: string,
  parentMessageId?: string
) {
  const { data, error } = await client.rpc('send_message_with_auto_join', {
    channel_name: channelName,
    content,
    parent_message_id: parentMessageId || null,
  });

  if (error) {
    console.error('Failed to post:', error.message);
    process.exit(1);
  }

  console.log(`Message posted to #${channelName}`);
}
