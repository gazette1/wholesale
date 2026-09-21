"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadDocument, type DocTarget } from "@/lib/actions/documents";
import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/misc";
import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";

// The server action enforces the same limit and the type allow list. These only save a wasted upload.
const MAX_BYTES = 25 * 1024 * 1024;
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic,.heif,.docx,.xlsx,.csv,.txt";

/** Drag and drop uploader for any document target: a lead, a property, or a buyer. */
export function DocumentUpload({ target }: { target: { kind: DocTarget; id: string } }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const [pending, start] = useTransition();
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);

  function upload(files: File[]) {
    if (busy.current || files.length === 0) return;
    busy.current = true;
    setErrors([]); setDone(null);
    start(async () => {
      const failed: string[] = [];
      let saved = 0;
      try {
        // One file per request keeps each request under the server action body limit.
        for (const [i, file] of files.entries()) {
          setProgress(`Uploading ${file.name} (${i + 1} of ${files.length})`);
          if (file.size > MAX_BYTES) { failed.push(`${file.name}: files are limited to 25 MB.`); continue; }
          const data = new FormData();
          data.set("file", file);
          try {
            const result = await uploadDocument(target.kind, target.id, data);
            if (result.ok) saved += 1; else failed.push(`${file.name}: ${result.error}`);
          } catch {
            failed.push(`${file.name}: the upload failed. The file may be larger than the server accepts.`);
          }
        }
      } finally {
        busy.current = false;
        setProgress(null);
        setErrors(failed);
        if (saved > 0) { setDone(`Uploaded ${saved} ${saved === 1 ? "file" : "files"}`); router.refresh(); }
        if (input.current) input.current.value = "";
      }
    });
  }

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); upload(Array.from(e.dataTransfer.files)); }}
        className={cn("flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center transition-colors", over ? "border-brand bg-brand/5" : "border-border bg-surface-2/60", pending && "opacity-70")}
      >
        <Upload className="h-5 w-5 text-fg-3" />
        <p className="text-[13px] text-fg-2">Drop files here</p>
        <Button type="button" variant="outline" size="sm" loading={pending} onClick={() => input.current?.click()}>Choose files</Button>
        <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" aria-label="Choose files to upload" onChange={(e) => upload(Array.from(e.target.files ?? []))} />
      </div>
      {progress ? <p role="status" className="text-xs text-fg-3">{progress}</p> : null}
      {done && !pending ? <p role="status" className="text-xs text-good">{done}</p> : null}
      {errors.length > 0 && !pending ? <Alert tone="bad">{errors.map((e) => <span key={e} className="block">{e}</span>)}</Alert> : null}
    </div>
  );
}
