"use client";
import { useEffect, useState } from "react";

/**
 * Hidden field carrying the browser's UTC offset in minutes. A datetime-local input posts a bare
 * wall clock time; the server uses this to read it in the user's zone instead of its own.
 */
export function TzOffset() {
  const [offset, setOffset] = useState("");
  useEffect(() => { setOffset(String(new Date().getTimezoneOffset())); }, []);
  return <input type="hidden" name="tzOffset" value={offset} readOnly />;
}
