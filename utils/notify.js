import fetch from 'node-fetch';

export async function notifyDiscord(msg) {
  console.log('Discord notification attempt:', {
    hasWebhook: !!process.env.DISCORD_WEBHOOK,
    webhookUrl: process.env.DISCORD_WEBHOOK ? 'Set' : 'Not set',
    messageLength: msg.length
  });
  
  if (!process.env.DISCORD_WEBHOOK) {
    console.log('Discord webhook not configured, skipping Discord notification');
    return;
  }
  
  try {
    const response = await fetch(process.env.DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: msg.slice(0, 2000) })  // 2k char limit
    });
    
    if (response.ok) {
      console.log('Discord notification sent successfully');
    } else {
      console.error('Discord notification failed:', response.status, response.statusText);
    }
  } catch (error) {
    console.error('Error sending Discord notification:', error.message);
  }
} 