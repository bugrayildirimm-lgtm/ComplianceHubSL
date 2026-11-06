// Client for the Compliance Hub API. Keeps the `base44` export name and call shapes
// (entities.X.list/filter/get/create/update/delete, functions.invoke, auth.me/logout) so the
// existing pages work unchanged against the portable server.
const TOKEN_KEY = 'hub_token';

class ApiError extends Error {
  constructor(status, message, data) { super(message); this.status = status; this.data = data; }
}

async function request(method, path, body) {
  const headers = { 'content-type': 'application/json' };
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, (data && data.error) || res.statusText, data);
  return data;
}

const entity = (name) => ({
  list: (sort, limit, skip) => request('POST', `/entities/${name}/query`, { query: {}, sort, limit, skip }),
  filter: (query, sort, limit, skip) => request('POST', `/entities/${name}/query`, { query, sort, limit, skip }),
  get: (id) => request('GET', `/entities/${name}/${id}`),
  create: (data) => request('POST', `/entities/${name}`, data),
  bulkCreate: (items) => request('POST', `/entities/${name}/bulk`, items),
  update: (id, data) => request('PUT', `/entities/${name}/${id}`, data),
  delete: (id) => request('DELETE', `/entities/${name}/${id}`),
  count: async (query) => (await request('POST', `/entities/${name}/count`, { query })).count,
  aggregate: (spec) => request('POST', `/entities/${name}/aggregate`, spec),
});

export const base44 = {
  entities: new Proxy({}, { get: (_t, name) => (typeof name === 'string' ? entity(name) : undefined) }),
  functions: {
    // Matches the previous contract: resolves { data }.
    invoke: async (name, payload) => ({ data: await request('POST', `/functions/${name}`, payload || {}) }),
  },
  auth: {
    me: () => request('GET', '/auth/me'),
    async login(email, password) {
      const result = await request('POST', '/auth/login', { email, password });
      localStorage.setItem(TOKEN_KEY, result.token);
      return result.user;
    },
    setToken: (token) => localStorage.setItem(TOKEN_KEY, token),
    async logout(redirectTo) {
      try { await request('POST', '/auth/logout'); } catch { /* ignore */ }
      localStorage.removeItem(TOKEN_KEY);
      if (redirectTo !== undefined && typeof window !== 'undefined') window.location.assign('/login');
    },
    updateMe: async () => { throw new ApiError(501, 'Profile updates are not available in this build.'); },
  },
};

export { ApiError };
