// Drop-in replacement for the parts of @base44/sdk the backend functions use.
// Functions import 'npm:@base44/sdk@x' and this module is substituted by the loader hook.
import { entityStore } from './entities.js';
import { userFromRequest } from './auth.js';
import { allowed } from './rls.js';
import { Core } from './integrations.js';

const forbidden = () => Object.assign(new Error('Forbidden'), { status: 403 });

function entitiesProxy(getUser, enforce) {
  return new Proxy({}, {
    get(_t, name) {
      if (typeof name !== 'string') return undefined;
      const store = entityStore(name);
      if (!enforce) return store;
      const ops = { list: 'read', filter: 'read', get: 'read', count: 'read', aggregate: 'read', create: 'create', bulkCreate: 'create', update: 'update', updateMany: 'update', bulkUpdate: 'update', delete: 'delete', deleteMany: 'delete' };
      return Object.fromEntries(Object.entries(store).map(([method, fn]) => [method, async (...args) => {
        if (!allowed(name, ops[method], await getUser())) throw forbidden();
        return fn(...args);
      }]));
    },
  });
}

export function createClientFromRequest(req) {
  let cached;
  const getUser = async () => (cached !== undefined ? cached : (cached = await userFromRequest(req)));
  return {
    entities: entitiesProxy(getUser, true),
    auth: {
      async me() {
        const user = await getUser();
        if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
        return user;
      },
    },
    asServiceRole: {
      entities: entitiesProxy(getUser, false),
      integrations: { Core },
    },
  };
}

// For scheduled jobs and scripts: no user, service role only.
export function createServiceClient() {
  return createClientFromRequest(new Request('http://localhost/internal'));
}
