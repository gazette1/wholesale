import type { LeadDetail } from "@/lib/data/leads";
import { DocumentList } from "@/components/documents/document-list";
import { DocumentUpload } from "@/components/documents/document-upload";
import { Card, CardHeader, CardBody } from "@/components/ui/card";

export async function DocumentsTab({ detail, canWrite, sessionProfileId, isAdmin }: { detail: LeadDetail; canWrite: boolean; sessionProfileId?: string; isAdmin?: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 min-w-0">
        <DocumentList docs={detail.documents} canWrite={canWrite} sessionProfileId={sessionProfileId} isAdmin={isAdmin} emptyDescription={canWrite ? "Upload contracts, photos, title work, and anything else that belongs with this lead." : "Nothing has been uploaded for this lead."} />
      </div>
      <Card>
        <CardHeader title="Upload" description="PDF, images, Word, Excel, CSV, or text. 25 MB per file." />
        <CardBody>{canWrite ? <DocumentUpload target={{ kind: "lead", id: detail.lead.id }} /> : <p className="text-xs text-fg-3">Your role cannot upload documents.</p>}</CardBody>
      </Card>
    </div>
  );
}
