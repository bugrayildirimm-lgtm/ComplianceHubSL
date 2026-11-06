// App-side conservative AI-call allowance, not a billing or credit balance.
export async function reserveUsage(base44, units = 1) {
  const E = base44.asServiceRole.entities.MonitoringConfig;
  for (let attempt = 0; attempt < 3; attempt++) {
    const records = await E.filter({ config_key: 'default' });
    const c = records[0];
    if (!c) return { ok: false, reason: 'Monitoring configuration is required before metered work.' };
    if (c.budget_paused) return { ok: false, reason: c.budget_paused_reason || 'Configured budget pause' };
    const budget = Number(c.monthly_credit_budget || 0);
    if (budget > 0 && Number(c.credits_used_estimate || 0) + units > budget) {
      await E.updateMany({ id: c.id, updated_date: c.updated_date }, { $set: { budget_paused: true, budget_paused_reason: 'Configured app-side AI allowance reached. Work and continuation positions are retained. This is not a billing balance.' } });
      return { ok: false, reason: 'Configured app-side AI allowance reached' };
    }
    const result = await E.updateMany({ id: c.id, updated_date: c.updated_date }, { $inc: { credits_used_estimate: units }, $set: { credits_used_note: 'Conservative reservations for attempted AI calls, not actual billed credits. Failed calls remain reserved; configured pause is respected.' } });
    if (result.updated === 1) return { ok: true };
  }
  return { ok: false, reason: 'Concurrent usage reservation; retry on the next scheduled batch.' };
}