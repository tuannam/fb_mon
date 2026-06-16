export async function setTelegramWebhook(token: string, webhookUrl: string): Promise<void> {
  const action = webhookUrl ? "setWebhook" : "deleteWebhook";
  const body = webhookUrl ? { url: webhookUrl, allowed_updates: ["message"] } : {};
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json()) as { ok: boolean };
    if (data.ok) {
      console.log(`Telegram webhook ${webhookUrl ? "registered: " + webhookUrl : "deleted"}`);
    } else {
      console.warn("Telegram setWebhook failed:", JSON.stringify(data));
    }
  } catch (e) {
    console.error("Telegram setWebhook error:", (e as Error).message);
  }
}

export async function sendTyping(token: string, chatId: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, action: "typing" }),
    });
  } catch (_) {}
}

export async function sendTelegramMessage(token: string, chatId: string, text: string): Promise<void> {
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("Telegram send error:", (e as Error).message);
  }
}
