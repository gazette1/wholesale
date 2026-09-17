import { NextResponse } from "next/server";
import { providerStatus } from "@dealcalc/integrations";
import { ENGINE_VERSION } from "@dealcalc/engine";

export async function GET() {
  return NextResponse.json({ ok: true, engine: ENGINE_VERSION, providers: providerStatus(), time: new Date().toISOString() });
}
