import { fileStorage } from "@dealcalc/integrations";
import { deleteDocument } from "@/lib/actions/documents";
import { ActionButton } from "@/components/ui/action-form";
import { Card, CardHeader, CardBody } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/misc";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { relative } from "@/lib/utils";
import { FileText, Download } from "lucide-react";

export type DocRow = { id: string; filename: string; mime: string; size: number; storagePath: string; uploadedBy: string | null; createdAt: Date };

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND: Record<string, string> = { "application/pdf": "PDF", "image/png": "Image", "image/jpeg": "Image", "image/webp": "Image", "image/heic": "Image", "image/heif": "Image", "text/csv": "CSV", "text/plain": "Text", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel" };

/** Table of uploaded files with a signed download link and a delete button, shared by the lead, property, and buyer document panels. */
export async function DocumentList({ docs, canWrite, sessionProfileId, isAdmin, emptyDescription }: { docs: DocRow[]; canWrite: boolean; sessionProfileId?: string; isAdmin?: boolean; emptyDescription: string }) {
  const storage = fileStorage();
  // A link that cannot be signed shows as unavailable instead of failing the whole list.
  const signed = await Promise.all(docs.map(async (d) => ({ ...d, url: await storage.signedUrl(d.storagePath).catch(() => null) })));
  if (signed.length === 0) return <EmptyState icon={FileText} title="No documents yet" description={emptyDescription} />;
  return (
    <Card>
      <CardHeader title="Documents" description="Download links expire after an hour." />
      <CardBody className="p-0 overflow-x-auto">
        <Table>
          <THead><tr><TH>File</TH><TH>Type</TH><TH right>Size</TH><TH>Uploaded</TH><TH></TH><TH></TH></tr></THead>
          <TBody>
            {signed.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium max-w-[280px] truncate" title={d.filename}>{d.filename}</TD>
                <TD className="text-fg-3">{KIND[d.mime] ?? d.mime}</TD>
                <TD right className="text-fg-3">{fileSize(d.size)}</TD>
                <TD className="text-fg-3">{relative(d.createdAt)}</TD>
                <TD>{d.url ? <a href={d.url} download={d.filename} className="inline-flex items-center gap-1 text-[13px] text-brand hover:underline"><Download className="h-3.5 w-3.5" />Download</a> : <span className="text-xs text-fg-3">Link unavailable</span>}</TD>
                <TD>{isAdmin || (canWrite && d.uploadedBy != null && d.uploadedBy === sessionProfileId) ? <ActionButton action={deleteDocument.bind(null, d.id)} size="sm" variant="ghost" className="text-bad" confirm={`Delete ${d.filename}? The file is removed from storage and cannot be restored.`}>Delete</ActionButton> : null}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </CardBody>
    </Card>
  );
}
