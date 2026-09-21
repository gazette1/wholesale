import { DocumentList, type DocRow } from "@/components/documents/document-list";
import { DocumentUpload } from "@/components/documents/document-upload";
import { Card, CardHeader, CardBody } from "@/components/ui/card";

/** Files that belong to the property itself (title, inspection, photos) rather than to one lead on it. They also show on the lead's Documents tab. */
export function PropertyDocuments({ propertyId, docs, canWrite, sessionProfileId, isAdmin }: { propertyId: string; docs: DocRow[]; canWrite: boolean; sessionProfileId?: string; isAdmin?: boolean }) {
  return (
    <div className="grid gap-4 lg:grid-cols-3 mt-4">
      <div className="lg:col-span-2 min-w-0">
        <DocumentList docs={docs} canWrite={canWrite} sessionProfileId={sessionProfileId} isAdmin={isAdmin} emptyDescription={canWrite ? "Upload title work, inspections, or photos for this property." : "Nothing has been uploaded for this property."} />
      </div>
      <Card>
        <CardHeader title="Upload" description="PDF, images, Word, Excel, CSV, or text. 25 MB per file." />
        <CardBody>{canWrite ? <DocumentUpload target={{ kind: "property", id: propertyId }} /> : <p className="text-xs text-fg-3">Your role cannot upload documents.</p>}</CardBody>
      </Card>
    </div>
  );
}
