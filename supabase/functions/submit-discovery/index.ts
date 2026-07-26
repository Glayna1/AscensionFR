import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Discovery = {
  source_type: string;
  source_id?: string | null;
  original_text: string;
  context?: Record<string, unknown>;
};

const MAX_BATCH = 500;
const MAX_TEXT = 8192;
const MAX_CONTEXT_BYTES = 32768;
const SOURCE_TYPES = new Set([
  "quest", "item", "spell", "npc", "creature", "achievement", "ui", "system", "unknown",
]);

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

async function sha256Hex(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" });

  const contentLength = Number(req.headers.get("content-length") ?? "0");
  if (contentLength > 2_000_000) return json(413, { error: "payload_too_large" });

  let body: { entries?: Discovery[] };
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "invalid_json" });
  }

  if (!Array.isArray(body.entries) || body.entries.length < 1 || body.entries.length > MAX_BATCH) {
    return json(400, { error: "invalid_batch" });
  }

  const normalized = [];
  for (const entry of body.entries) {
    const sourceType = String(entry.source_type || "unknown").toLowerCase();
    const originalText = String(entry.original_text || "").trim();
    const sourceId = entry.source_id == null ? null : String(entry.source_id).slice(0, 128);
    const context = entry.context && typeof entry.context === "object" ? entry.context : {};
    const contextJson = JSON.stringify(context);

    if (!SOURCE_TYPES.has(sourceType)) return json(400, { error: "invalid_source_type" });
    if (!originalText || originalText.length > MAX_TEXT) return json(400, { error: "invalid_text" });
    if (new TextEncoder().encode(contextJson).byteLength > MAX_CONTEXT_BYTES) {
      return json(400, { error: "context_too_large" });
    }

    const field = typeof context.field === "string" ? context.field : "";
    const fingerprint = await sha256Hex([sourceType, sourceId ?? "", field, originalText].join("\x1f"));
    normalized.push({ source_type: sourceType, source_id: sourceId, original_text: originalText, context, fingerprint });
  }

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json(503, { error: "service_not_configured" });

  // service_role is used ONLY server-side in the Edge Function.
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });
  let accepted = 0;

  for (const entry of normalized) {
    const { data: existing, error: readError } = await supabase
      .from("translation_entries")
      .select("id,discovered_count")
      .eq("fingerprint", entry.fingerprint)
      .maybeSingle();
    if (readError) return json(500, { error: "database_read_failed" });

    if (existing) {
      const { error } = await supabase
        .from("translation_entries")
        .update({ discovered_count: existing.discovered_count + 1, last_seen_at: new Date().toISOString() })
        .eq("id", existing.id);
      if (error) return json(500, { error: "database_update_failed" });
    } else {
      const { error } = await supabase.from("translation_entries").insert(entry);
      if (error) return json(500, { error: "database_insert_failed" });
    }
    accepted++;
  }

  return json(200, { accepted });
});
