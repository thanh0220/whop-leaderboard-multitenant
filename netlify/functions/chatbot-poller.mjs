import { pointsStore, tenantKey } from "./_store.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig } from "./_tenant.mjs";

// Netlify Scheduled Function — every 2 minutes
// Polls Whop support channels for user replies to pending chatbot option menus.
// When a user replies "1", "2", etc., writes result to chatbot-reply blob for
// downstream flows (drip, admin, etc.) to act on.

export const handler = async (event) => {
  const store = pointsStore();
  const tenantIds = await store.get(tenantKey("tenant-registry", "all"), { type: "json" }).catch(() => null) || [];

  let processed = 0, replied = 0, expired = 0, errors = 0;

  for (const companyId of tenantIds) {
    try {
      const cfg = await getTenantConfig(companyId);
      if (!cfg.chatbotEnabled) continue;

      const apiKey = await getCompanyAccessToken(companyId);
      const realCompanyId = await getRealCompanyId(companyId, cfg);

      // Find all pending chatbot option menus for this company
      let pendingBlobs = [];
      try {
        const { blobs } = await store.list({ prefix: `chatbot-pending:${companyId}:` });
        pendingBlobs = blobs || [];
      } catch (_) { continue; }

      for (const blobMeta of pendingBlobs) {
        processed++;
        let pending = null;
        try { pending = await store.get(blobMeta.key, { type: "json" }); } catch (_) { continue; }
        if (!pending) continue;

        // Remove stale entries
        if (new Date(pending.expiresAt) < new Date()) {
          await store.delete(blobMeta.key).catch(() => {});
          expired++;
          continue;
        }

        // userId is everything after "chatbot-pending:{companyId}:" in the key
        const prefix = `chatbot-pending:${companyId}:`;
        const userId = blobMeta.key.slice(prefix.length);

        // Poll messages in this support channel sent after the bot's message
        let messages = [];
        try {
          const r = await fetch(
            `https://api.whop.com/api/v1/messages?channel_id=${encodeURIComponent(pending.channelId)}&created_after=${encodeURIComponent(pending.sentAt)}&per_page=10`,
            { headers: { Authorization: `Bearer ${apiKey}` } }
          );
          if (r.ok) {
            const data = await r.json().catch(() => ({}));
            // Keep only messages from the member (not the bot)
            messages = (data.data || []).filter(m => {
              const senderId = m.user_id || m.sender?.id || m.sender_id;
              return senderId === userId;
            });
          }
        } catch (_) { continue; }

        if (messages.length === 0) continue;

        // Check oldest user reply for a valid numbered choice
        const sorted = messages.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        const replyText = (sorted[0]?.content || "").trim();
        const num = parseInt(replyText, 10);
        const idx = num - 1;

        if (num >= 1 && idx < pending.options.length) {
          replied++;
          // Persist choice for downstream consumption
          await store.setJSON(tenantKey("chatbot-reply", companyId, userId), {
            flowId: pending.flowId,
            chosenOption: pending.options[idx],
            chosenIndex: idx,
            repliedAt: new Date().toISOString(),
          });
          await store.delete(blobMeta.key).catch(() => {});
        }
      }
    } catch (err) {
      errors++;
      console.error(`[chatbot-poller] ${companyId}:`, err.message);
    }
  }

  console.log(`[chatbot-poller] processed:${processed} replied:${replied} expired:${expired} errors:${errors}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, processed, replied, expired, errors }) };
};
