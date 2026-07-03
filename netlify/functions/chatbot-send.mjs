import { pointsStore, tenantKey } from "./_store.mjs";
import { getAuthContext } from "./_auth.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig } from "./_tenant.mjs";

const json = (code, obj) => ({
  statusCode: code,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(obj),
});

const EMOJIS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

// Exported for use by drip.mjs — internal call, no auth needed
export async function sendChatbotMessage(realCompanyId, apiKey, userId, companyId, {
  message,
  options = [],
  imageUrl = null,
  flowId = null,
  botName = null,
}) {
  // Get or create support channel for this user
  const chanR = await fetch("https://api.whop.com/api/v1/support_channels", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ company_id: realCompanyId, user_id: userId }),
  });
  if (!chanR.ok) {
    const t = await chanR.text().catch(() => "");
    throw new Error(`support_channel ${chanR.status}: ${t.slice(0, 120)}`);
  }
  const chan = await chanR.json();

  // Build content: optional image URL first, then message, then numbered options
  let content = message.trim();
  if (imageUrl) content = `${imageUrl}\n\n${content}`;
  if (options.length > 0) {
    const lines = options.map((o, i) => `${EMOJIS[i] || `${i + 1}.`} ${o}`);
    content += `\n\n${lines.join("\n")}\n\n_(Trả lời bằng số để chọn)_`;
  }

  const msgBody = { channel_id: chan.id, content };
  if (botName) msgBody.agent_name = botName; // set chatbot display name

  const msgR = await fetch("https://api.whop.com/api/v1/messages", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(msgBody),
  });
  if (!msgR.ok) {
    const t = await msgR.text().catch(() => "");
    throw new Error(`message ${msgR.status}: ${t.slice(0, 120)}`);
  }

  // Save pending-reply state when options are provided so poller can detect response
  if (options.length > 0 && flowId) {
    const store = pointsStore();
    await store.setJSON(tenantKey("chatbot-pending", companyId, userId), {
      channelId: chan.id,
      options,
      flowId,
      sentAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    });
  }

  return { channelId: chan.id };
}

// HTTP handler — admin sends a one-off chatbot message to a user
export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });

  const { userId, companyId } = await getAuthContext(event);
  if (!userId) return json(401, { error: "Not authenticated." });
  if (!companyId) return json(400, { error: "No community found." });

  let body = {};
  try { body = JSON.parse(event.body || "{}"); } catch (_) {}

  const { targetUserId, message, options, imageUrl, flowId } = body;
  if (!targetUserId || typeof targetUserId !== "string") return json(400, { error: "targetUserId required." });
  if (!message || typeof message !== "string" || !message.trim()) return json(400, { error: "message required." });

  try {
    const cfg = await getTenantConfig(companyId);
    const apiKey = await getCompanyAccessToken(companyId);
    const realCompanyId = await getRealCompanyId(companyId, cfg);

    const result = await sendChatbotMessage(realCompanyId, apiKey, targetUserId, companyId, {
      message,
      options: Array.isArray(options) ? options.slice(0, 5) : [],
      imageUrl: typeof imageUrl === "string" ? imageUrl : null,
      flowId: typeof flowId === "string" ? flowId : null,
      botName: cfg.chatbotName || null,
    });

    return json(200, { ok: true, ...result });
  } catch (err) {
    return json(500, { error: err.message });
  }
};
