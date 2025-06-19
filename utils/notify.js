import fetch from 'node-fetch';

export async function notifyDiscord(msg) {
  if (!process.env.DISCORD_WEBHOOK) return;
  await fetch(process.env.DISCORD_WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: msg.slice(0, 2000) })  // 2k char limit
  });
} 