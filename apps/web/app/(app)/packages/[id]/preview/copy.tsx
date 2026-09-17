"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return <Button variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 2000); } catch { window.prompt("Copy this link", text); } }}>{done ? "Copied" : "Copy share link"}</Button>;
}
