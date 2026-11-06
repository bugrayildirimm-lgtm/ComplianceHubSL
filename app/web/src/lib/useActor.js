import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";

const EMPTY = { loading: false, email: null, name: null, role: null, canWrite: false, canApprove: false, canAdministerRoles: false, canReadAudit: false, isAppAdmin: false, admitted: false, reason: null, member: null };

// Resolves the signed-in person to their Compliance Hub access role through the
// server-side admission check. App administrator status alone never carries
// approval authority, and no signed-in account is admitted without the server check.
export default function useActor() {
  const [state, setState] = useState({ ...EMPTY, loading: true });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let user = null;
      try {
        user = await base44.auth.me();
      } catch (_e) {
        user = null;
      }
      if (!user) {
        if (!cancelled) setState({ ...EMPTY });
        return;
      }
      let access = null;
      try {
        const res = await base44.functions.invoke("admitUser", {});
        access = res?.data || null;
      } catch (_e) {
        access = null;
      }
      if (!cancelled) {
        setState({
          loading: false,
          email: user.email,
          name: user.full_name || user.email,
          role: access?.role || "Read-only",
          isAppAdmin: user.role === "admin",
          admitted: Boolean(access?.admitted),
          reason: access?.reason || null,
          member: access?.member || null,
          canWrite: Boolean(access?.admitted && access?.can_write),
          canApprove: Boolean(access?.can_approve),
          canAdministerRoles: Boolean(access?.can_administer_roles),
          canReadAudit: Boolean(access?.can_audit),
        });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return state;
}