// Entity-level access rules from the Base44 `rls` blocks in server/entities/*.jsonc.
// All rules in this app are conditions on the signed-in user, so they are evaluated per request.
// Field-level rls (inside individual properties) is NOT enforced here; the server-side functions
// remain the write path for sensitive fields. See docs/spec.md.
import { loadRegistry } from './entities.js';

function matchesCondition(cond, user) {
  if (!cond) return true;
  if (cond.$and) return cond.$and.every((c) => matchesCondition(c, user));
  if (cond.$or) return cond.$or.some((c) => matchesCondition(c, user));
  if (cond.user_condition) {
    return Object.entries(cond.user_condition).every(([key, expected]) => {
      if (key === 'collaborator_role') return user.role === 'admin' && expected === 'editor';
      const field = key.startsWith('data.') ? key.slice(5) : key;
      return user[field] === expected;
    });
  }
  return false;
}

export function allowed(entityName, operation, user) {
  const def = loadRegistry()[entityName];
  if (!def) return false;
  if (!user) return false;
  const rule = def.rls?.[operation];
  if (rule === undefined) return user.role === 'admin' || user.access_admitted === true;
  return matchesCondition(rule, user);
}
