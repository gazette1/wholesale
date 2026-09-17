import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { env } from "../env";

export interface FileStorage {
  readonly name: string;
  put(path: string, data: Uint8Array | Buffer, contentType: string): Promise<{ path: string }>;
  get(path: string): Promise<Buffer | null>;
  remove(path: string): Promise<void>;
  /** Time limited URL for a private file, or a local route when running without Supabase. */
  signedUrl(path: string, expiresInSeconds?: number): Promise<string>;
}

export const BUCKET = "crm-files";

/** Files under .storage/ next to the repo. Development only. */
export class LocalFileStorage implements FileStorage {
  readonly name = "local";
  constructor(private readonly root = resolve(process.cwd(), ".storage")) {}
  async put(path: string, data: Uint8Array | Buffer) {
    const full = resolve(this.root, path);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, data);
    return { path };
  }
  async get(path: string) {
    const full = resolve(this.root, path);
    return existsSync(full) ? readFileSync(full) : null;
  }
  async remove(path: string) {
    const full = resolve(this.root, path);
    if (existsSync(full)) rmSync(full);
  }
  async signedUrl(path: string) {
    return `/api/files/${encodeURIComponent(path)}`;
  }
}

export class SupabaseFileStorage implements FileStorage {
  readonly name = "supabase";
  private client;
  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }
  async put(path: string, data: Uint8Array | Buffer, contentType: string) {
    const { error } = await this.client.storage.from(BUCKET).upload(path, data, { contentType, upsert: true });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return { path };
  }
  async get(path: string) {
    const { data, error } = await this.client.storage.from(BUCKET).download(path);
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(path: string) {
    await this.client.storage.from(BUCKET).remove([path]);
  }
  async signedUrl(path: string, expiresInSeconds = 3600) {
    const { data, error } = await this.client.storage.from(BUCKET).createSignedUrl(path, expiresInSeconds);
    if (error || !data) throw new Error(`Signed URL failed: ${error?.message}`);
    return data.signedUrl;
  }
}

let cached: FileStorage | undefined;
export function fileStorage(): FileStorage {
  if (cached) return cached;
  const e = env();
  cached = e.NEXT_PUBLIC_SUPABASE_URL && e.SUPABASE_SERVICE_ROLE_KEY ? new SupabaseFileStorage(e.NEXT_PUBLIC_SUPABASE_URL, e.SUPABASE_SERVICE_ROLE_KEY) : new LocalFileStorage();
  return cached;
}
