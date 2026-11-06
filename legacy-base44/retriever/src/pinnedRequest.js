// One HTTPS request to one already-validated address.
// The hostname is kept for TLS (SNI + certificate hostname verification); the socket is
// forced to the validated address by a custom `lookup`, so no second, unvalidated
// resolution can redirect the connection. Certificate verification is never disabled.
import https from 'node:https';
import dns from 'node:dns';

export function defaultResolver(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
}

export async function pinnedGet({ hostname, address, family, path, port, timeoutMs, maxBytes, userAgent, accept }) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const request = https.request(
      {
        hostname, // TLS servername and certificate check use the official hostname
        port,
        path,
        method: 'GET',
        agent: false,
        headers: { Accept: accept, 'User-Agent': userAgent, 'Accept-Encoding': 'identity', Connection: 'close' },
        lookup: (_host, options, callback) => {
          // Pin: this is the only address the socket may use.
          if (options && options.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
      },
      (response) => {
        const declared = Number(response.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          response.destroy();
          request.destroy();
          return done({ ok: false, code: 'RESPONSE_TOO_LARGE', message: `Declared size ${declared} exceeds the ${maxBytes} byte limit.`, stage: 'response' });
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            response.destroy();
            request.destroy();
            return done({ ok: false, code: 'RESPONSE_TOO_LARGE', message: `Response exceeded the ${maxBytes} byte limit.`, stage: 'response' });
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          done({
            ok: true,
            status: response.statusCode || 0,
            headers: {
              'content-type': response.headers['content-type'] || '',
              location: response.headers.location || '',
              'content-length': response.headers['content-length'] || '',
            },
            body: Buffer.concat(chunks),
          })
        );
        response.on('error', (error) => done({ ok: false, code: 'RESPONSE_ABORTED', message: error.message, stage: 'response' }));
      }
    );

    request.setTimeout(timeoutMs, () => {
      request.destroy();
      done({ ok: false, code: 'TIMEOUT', message: `No complete response within ${timeoutMs} ms.`, stage: 'timeout', retryable: true });
    });
    request.on('error', (error) => {
      const tls = /CERT|SSL|TLS/i.test(`${error.code || ''} ${error.message || ''}`);
      done({
        ok: false,
        code: tls ? 'TLS_VALIDATION_FAILED' : error.code === 'ENOTFOUND' ? 'RESOLUTION_FAILED' : 'CONNECTION_FAILED',
        message: error.message,
        stage: 'connect',
        retryable: ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(error.code),
      });
    });
    request.end();
  });
}