import { useState } from "react";
import PageHeader from "@/components/PageHeader";
import ImportReview from "@/components/discovery/ImportReview";
import SourceDiscovery from "@/components/discovery/SourceDiscovery";
import RegisterReconciliation from "@/components/discovery/RegisterReconciliation";
import DiscoveryQueuePanel from "@/components/discovery/DiscoveryQueuePanel";
import SearchBasedDiscovery from "@/components/discovery/SearchBasedDiscovery";

export default function DiscoveryReview() {
  const [tab, setTab] = useState("import");

  return (
    <>
      <PageHeader
        eyebrow="Controlled onboarding"
        title="Source Discovery & Import Review"
        description="Two separate review queues: staged jurisdiction rows on their way into the master register, and candidate official sources on their way into monitoring."
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-border">
        {[
          { key: "import", label: "Jurisdiction import" },
          { key: "reconciliation", label: "Register reconciliation" },
          { key: "queue", label: "Discovery queue" },
          { key: "discovery", label: "Single-jurisdiction search" },
          { key: "searchbased", label: "Search-based discovery" },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`-mb-px border-b-2 px-3 py-2 text-[12.5px] ${tab === item.key ? "border-green-700 font-medium text-slate-900" : "border-transparent text-slate-500 hover:text-slate-800"}`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === "import" && <ImportReview />}
      {tab === "reconciliation" && <RegisterReconciliation />}
      {tab === "queue" && <DiscoveryQueuePanel />}
      {tab === "discovery" && <SourceDiscovery />}
      {tab === "searchbased" && <SearchBasedDiscovery />}
    </>
  );
}