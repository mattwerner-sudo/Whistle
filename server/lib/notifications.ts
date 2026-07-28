// server/lib/notifications.ts

const SLACK_WEBHOOK = process.env.SLACK_WEBHOOK_URL;

export async function sendSlackAlert(message: string, type: 'info' | 'success' | 'alert' = 'info') {
  if (!SLACK_WEBHOOK) {
    console.log(`[Slack Mock] ${message}`);
    return;
  }

  const icons = { info: 'ℹ️', success: '✅', alert: '🚨' };
  
  try {
    await fetch(SLACK_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `${icons[type]} *Athletics Directory Alert*\n${message}`
      })
    });
  } catch (err) {
    console.error("Failed to send Slack alert:", err);
  }
}
