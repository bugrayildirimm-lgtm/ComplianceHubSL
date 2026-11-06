import PageHeader from "@/components/PageHeader";
import BaselineMatrix from "@/components/requirements/BaselineMatrix";

export default function BaselineResearch() {
  return (
    <>
      <PageHeader
        eyebrow="Requirements baseline"
        title="Baseline Research by Jurisdiction & Category"
        description="Market entry, slots, live casino and studio requirements researched from official instruments. Drafts stay unreviewed until an authorised reviewer acts."
      />
      <BaselineMatrix />
    </>
  );
}