import { ShieldAlert } from "lucide-react";
import { Link } from 'react-router-dom';
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";

// Shown instead of the workspace when a signed-in account is not on the
// compliance roster. No compliance data is loaded or rendered here.
export default function AccessNotAdmitted({ email }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="panel w-full max-w-md p-6">
        <div className="mb-4 flex items-center gap-3">
          <img
            src="https://media.base44.com/images/public/6aea053a32da25b998ffa48c/2419c8a9e_logo.png"
            alt="Stakelogic"
            className="h-8 w-8 rounded-sm object-contain"
          />
          <div className="leading-tight">
            <div className="text-[13px] font-semibold text-slate-900">Compliance Hub</div>
            <div className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">Stakelogic</div>
          </div>
        </div>

        <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md border border-amber-200 bg-amber-50 text-amber-700">
          <ShieldAlert className="h-4.5 w-4.5" />
        </div>
        <h1 className="text-[16px] font-semibold text-slate-900">Access not admitted</h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {email ? <>You are signed in as <span className="font-medium text-slate-700">{email}</span>, which is not</> : "This account is not"} on the Compliance Hub roster.
          An authorised Compliance Hub roster Administrator must admit your address with an access role before any register, monitoring or requirement data can be opened.
        </p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
          Signing in to Base44 on its own does not grant access to compliance records.
        </p>

        <div className="mt-5 flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => base44.auth.logout()}>
            Sign out
          </Button>
          <Link to="/access-acceptance" className="text-xs text-accent underline">Assigned acceptance checks</Link>
        </div>
      </div>
    </div>
  );
}