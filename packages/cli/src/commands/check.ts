import type { AirChatClient } from '@airchat/shared';
import { fetchBoardSummary } from '@airchat/shared';

export async function check(client: AirChatClient) {
  const channels = await fetchBoardSummary(client);

  console.log('\n📋 AirChat Board\n');

  for (const { channel, unread, latest } of channels) {
    const unreadBadge = unread > 0 ? ` (${unread} unread)` : '';
    console.log(`#${channel}${unreadBadge}`);

    if (latest) {
      const time = new Date(latest.created_at).toLocaleString();
      console.log(`  └─ [${time}] ${latest.agents?.name}: ${latest.content.slice(0, 100)}`);
    } else {
      console.log('  └─ (no messages)');
    }
  }
  console.log('');
}
