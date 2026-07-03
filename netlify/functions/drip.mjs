import { pointsStore, tenantKey } from "./_store.mjs";
import { getCompanyAccessToken, getRealCompanyId } from "./_tokens.mjs";
import { getTenantConfig } from "./_tenant.mjs";
import { sendChatbotMessage } from "./chatbot-send.mjs";

// Netlify Scheduled Function — every day 09:00 UTC
// Processes linear drip sequences: for each enrolled user, send the next step
// if its delay has elapsed, then advance the pointer.

export const handler = async (event) => {
  const store = pointsStore();
  const tenantIds = await store.get(tenantKey("tenant-registry", "all"), { type: "json" }).catch(() => null) || [];

  let sent = 0, completed = 0, skipped = 0, errors = 0;

  for (const companyId of tenantIds) {
    try {
      const cfg = await getTenantConfig(companyId);
      if (!cfg.dripEnabled || !cfg.dripSequences?.length) { skipped++; continue; }

      const apiKey = await getCompanyAccessToken(companyId);
      const realCompanyId = await getRealCompanyId(companyId, cfg);
      const botName = cfg.chatbotName || null;

      // Find all drip enrollments for this company
      let enrollBlobs = [];
      try {
        const { blobs } = await store.list({ prefix: `drip-enroll:${companyId}:` });
        enrollBlobs = blobs || [];
      } catch (_) { continue; }

      for (const blobMeta of enrollBlobs) {
        let enrollment = null;
        try { enrollment = await store.get(blobMeta.key, { type: "json" }); } catch (_) { continue; }
        if (!enrollment || enrollment.completed) continue;

        // Not yet time to send next step
        if (new Date(enrollment.nextSendAt) > new Date()) continue;

        const { userId, sequenceId, step } = enrollment;
        const seq = cfg.dripSequences.find(s => s.id === sequenceId);
        if (!seq) {
          await store.delete(blobMeta.key).catch(() => {});
          continue;
        }

        const currentStep = seq.steps?.[step];
        if (!currentStep) {
          // Sequence finished
          await store.setJSON(blobMeta.key, {
            ...enrollment,
            completed: true,
            completedAt: new Date().toISOString(),
          });
          completed++;
          continue;
        }

        // Send the step message
        try {
          await sendChatbotMessage(realCompanyId, apiKey, userId, companyId, {
            message: currentStep.message,
            options: currentStep.options || [],
            imageUrl: currentStep.imageUrl || null,
            flowId: `drip:${sequenceId}:step${step}`,
            botName,
          });
          sent++;
        } catch (e) {
          errors++;
          console.error(`[drip] send failed ${companyId}/${userId} step${step}:`, e.message);
          continue; // keep same step, retry next run
        }

        // Advance to next step
        const nextStep = step + 1;
        const isDone = nextStep >= (seq.steps?.length || 0);
        const nextDelay = isDone ? 0 : (seq.steps[nextStep]?.delayDays ?? 1);

        await store.setJSON(blobMeta.key, {
          ...enrollment,
          step: nextStep,
          lastSentAt: new Date().toISOString(),
          nextSendAt: new Date(Date.now() + nextDelay * 86_400_000).toISOString(),
          completed: isDone,
          ...(isDone ? { completedAt: new Date().toISOString() } : {}),
        });

        if (isDone) completed++;
      }
    } catch (err) {
      errors++;
      console.error(`[drip] ${companyId}:`, err.message);
    }
  }

  console.log(`[drip] sent:${sent} completed:${completed} skipped:${skipped} errors:${errors}`);
  return { statusCode: 200, body: JSON.stringify({ ok: true, sent, completed, skipped, errors }) };
};
