// Runs the Base44 workflow definitions (server/workflows/*.jsonc) on their cron schedules.
// Each tick calls the named function as the designated job-runner user recorded in
// MonitoringConfig, which is how the functions authorise unattended runs.
// Disabled unless SCHEDULER_ENABLED=true, so this server never collects in parallel with Base44.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseJsonc } from 'jsonc-parser';
import { Cron } from 'croner';
import { entityStore } from './entities.js';
import { signToken } from './auth.js';
import { callFunction } from './functions.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'workflows');

export function loadWorkflows() {
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonc')).map((f) => {
    const def = parseJsonc(fs.readFileSync(path.join(dir, f), 'utf8'));
    const cfg = def.trigger?.config || {};
    const step = Object.values(def.definition?.do?.[0] || {})[0] || {};
    return {
      name: def.name,
      cron: cfg.trigger_type === 'scheduled' && cfg.schedule_mode === 'recurring' ? cfg.cron_expression : null,
      timezone: cfg.timezone || 'UTC',
      functionName: step.with?.function_name,
      args: step.with?.args || {},
    };
  });
}

export async function runWorkflow(wf, log = console) {
  const [config] = await entityStore('MonitoringConfig').filter({ config_key: 'default' }, null, 1);
  const runnerId = config?.job_runner_user_id;
  if (!config || config.job_runner_active !== true || !runnerId) {
    log.log(`[scheduler] ${wf.name}: skipped (no active designated job runner in MonitoringConfig)`);
    return { skipped: true };
  }
  const [runner] = await entityStore('User').filter({ id: runnerId }, null, 1);
  if (!runner) { log.log(`[scheduler] ${wf.name}: skipped (job runner user not found)`); return { skipped: true }; }
  const req = new Request(`http://localhost/api/functions/${wf.functionName}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${signToken({ sub: runner.id, email: runner.email })}` },
    body: JSON.stringify(wf.args),
  });
  const res = await callFunction(wf.functionName, req);
  log.log(`[scheduler] ${wf.name} -> ${wf.functionName} HTTP ${res.status}`);
  return { status: res.status };
}

export function startScheduler(log = console) {
  const jobs = [];
  for (const wf of loadWorkflows()) {
    if (!wf.cron || !wf.functionName) continue;
    let running = false;
    jobs.push(new Cron(wf.cron, { timezone: wf.timezone, protect: true }, async () => {
      if (running) return;
      running = true;
      try { await runWorkflow(wf, log); } catch (e) { log.error(`[scheduler] ${wf.name} failed: ${e.message}`); } finally { running = false; }
    }));
    log.log(`[scheduler] ${wf.name}: ${wf.cron} (${wf.timezone})`);
  }
  return jobs;
}
