// HTTP surface: GET /healthz and POST /retrieve. No CONNECT, no proxying, no other routes.
import http from 'node:http';
import { CONTRACT_VERSION, loadConfig } from './config.js';
import { createReplayStore, verifyRequest } from './auth.js';
import { createRetriever } from './retrieve.js';
import crypto from 'node:crypto';

export function createServer({ config = loadConfig(), resolver, replayStore = createReplayStore() } = {}) {
  const retrieve = createRetriever({ config, resolver });

  return http.createServer((req, res) => {
    const send = (status, payload) => {
      const body = JSON.stringify(payload);
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
    };

    if (req.method === 'GET' && req.url === '/healthz') {
      return send(200, { status: 'ok', contract_version: CONTRACT_VERSION, approved_hosts: config.approvedHosts.length, candidate_mode: config.allowCandidate });
    }
    if (req.url !== '/retrieve') return send(404, { code: 'NOT_FOUND', message: 'Only /retrieve and /healthz exist on this service.' });
    if (req.method !== 'POST') return send(405, { code: 'METHOD_NOT_ALLOWED', message: 'Retrieval requests must be POST.' });
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      return send(415, { code: 'UNSUPPORTED_REQUEST_TYPE', message: 'Content-Type must be application/json.' });
    }

    const chunks = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk) => {
      if (aborted) return;
      size += chunk.length;
      if (size > config.maxRequestBodyBytes) {
        aborted = true;
        send(413, { code: 'REQUEST_TOO_LARGE', message: 'Request body exceeds the permitted size.' });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', async () => {
      if (aborted) return;
      const bodyText = Buffer.concat(chunks).toString('utf8');

      const auth = verifyRequest({ headers: req.headers, bodyText, secret: config.sharedSecret, skewSeconds: config.authSkewSeconds, replayStore });
      if (!auth.ok) return send(auth.status, { code: auth.code, message: auth.message });

      let input;
      try {
        input = JSON.parse(bodyText);
      } catch {
        return send(400, { code: 'INVALID_JSON', message: 'Request body must be JSON.' });
      }
      if (!input || typeof input !== 'object' || Array.isArray(input)) return send(400, { code: 'INVALID_REQUEST', message: 'Request body must be a JSON object.' });

      const allowed = new Set(['url', 'mode', 'source_ref', 'request_id']);
      const extra = Object.keys(input).filter((key) => !allowed.has(key));
      if (extra.length) return send(400, { code: 'UNEXPECTED_FIELDS', message: `This service accepts only collection inputs; rejected: ${extra.join(', ')}.` });
      if (typeof input.url !== 'string' || !input.url) return send(400, { code: 'URL_REQUIRED', message: 'url is required.' });
      if (input.url.length > 2048) return send(400, { code: 'URL_TOO_LONG', message: 'url is longer than 2048 characters.' });
      if (input.mode && !['monitoring', 'candidate'].includes(input.mode)) return send(400, { code: 'INVALID_MODE', message: 'mode must be monitoring or candidate.' });

      try {
        const { envelope, error } = await retrieve({
          url: input.url,
          mode: input.mode || 'monitoring',
          source_ref: typeof input.source_ref === 'string' ? input.source_ref.slice(0, 120) : null,
          request_id: typeof input.request_id === 'string' && input.request_id ? input.request_id.slice(0, 80) : crypto.randomUUID(),
        });
        if (error) return send(error.status, { ...envelope, error: { code: error.code, message: error.message, stage: error.stage || 'request', retryable: Boolean(error.retryable) } });
        return send(200, envelope);
      } catch (unexpected) {
        return send(500, { code: 'RETRIEVER_ERROR', message: 'Retrieval failed inside the service.', detail: String(unexpected.message).slice(0, 200), request_id: input.request_id || null });
      }
    });
  });
}

if (process.argv[1] && process.argv[1].endsWith('server.js')) {
  const config = loadConfig();
  if (!config.sharedSecret) {
    console.error('RETRIEVER_HMAC_SECRET is not set; refusing to start.');
    process.exit(1);
  }
  const server = createServer({ config });
  server.listen(config.port, () => console.log(`retriever listening on ${config.port}; approved hosts: ${config.approvedHosts.length}`));
}