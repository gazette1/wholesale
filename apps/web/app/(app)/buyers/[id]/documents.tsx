import { DocumentList, type DocRow } from "@/components/documents/document-list";
import { DocumentUpload } from "@/components/documents/document-upload";
import { Card, CardHeader, CardBody } from "@/components/ui/card";

/** Proof of funds, purchase agreements, and anything else on file for a buyer. */
export function BuyerDocuments({ buyerId, docs, canWrite, sessionProfileId, isAdmin }: { buyerId: string; docs: DocRow[]; canWrite: boolean; sessionProfileId?: string; isAdmin?: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="lg:col-span-2 min-w-0">
        <DocumentList docs={docs} canWrite={canWrite} sessionProfileId={sessionProfileId} isAdmin={isAdmin} emptyDescription={canWrite ? "Upload proof of funds or an agreement for this buyer." : "Nothing has been uploaded for this buyer."} />
      </div>
      <Card>
        <CardHeader title="Upload" description="PDF, images, Word, Excel, CSV, or text. 25 MB per file." />
        <CardBody>{canWrite ? <DocumentUpload target={{ kind: "buyer", id: buyerId }} /> : <p className="text-xs text-fg-3">Your role cannot upload documents.</p>}</CardBody>
      </Card>
    </div>
  );
}
