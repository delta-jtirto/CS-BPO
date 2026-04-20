import { Hono } from "npm:hono";
import { cors } from "npm:hono/cors";
import { logger } from "npm:hono/logger";
import * as kv from "./kv_store.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.49.8";

const app = new Hono();

// ─── Service-role Supabase client ────────────────────────
// Bypasses RLS for idempotency writes; scoping is enforced by explicit
// company_id checks in each handler (see resolveCompanyIds).
function dbClient() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

// ─── Auth / company-id resolution ────────────────────────
// JWT is verified via auth.getUser() — an HTTP call to the gotrue auth
// service which checks signature + expiry + revocation. We cannot rely
// on Supabase Functions to have verify_jwt=true (no config.toml in this
// repo, and the default for older Figma Make functions is uncertain),
// so we verify explicitly on every request. The extra round-trip is
// worth it — silently trusting a decoded-but-unverified payload would
// be a tenant-crossing security hole.
async function resolveCompanyIds(authHeader: string | undefined): Promise<string[]> {
  if (!authHeader) return [];
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return [];

  // Verify the JWT by asking the auth service to resolve the user. Any
  // tampered or expired token yields `error` / `user === null` and we
  // treat it as unauthenticated.
  const verifyClient = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: { user }, error } = await verifyClient.auth.getUser();
  if (error || !user) return [];

  // Preferred scope: JWT claim `app_metadata.companies`. Admins set this
  // when provisioning a user so downstream services can avoid the
  // user_companies round-trip entirely.
  const jwtCompanies = (user.app_metadata as { companies?: unknown })?.companies;
  if (Array.isArray(jwtCompanies) && jwtCompanies.length > 0) {
    return jwtCompanies.filter((c: unknown): c is string => typeof c === "string");
  }

  // Secondary scope: user_companies table.
  try {
    const { data } = await dbClient()
      .from("user_companies")
      .select("company_id")
      .eq("user_id", user.id);
    if (data && data.length > 0) {
      return data.map((r: { company_id: string }) => r.company_id);
    }
  } catch {
    // Table may not exist on older deploys — fall through to prototype default.
  }

  // Single-tenant prototype default — matches the SQL fallback. Remove
  // once every authenticated user has either an app_metadata.companies
  // claim or a user_companies row.
  return ["delta-hq"];
}

async function requireCompanyId(c: any, requested: string): Promise<{ ok: true } | { ok: false; status: number; body: unknown }> {
  const allowed = await resolveCompanyIds(c.req.header("Authorization"));
  if (allowed.length === 0) {
    return { ok: false, status: 401, body: { error: "Unauthorized: no valid session" } };
  }
  if (!allowed.includes(requested)) {
    return { ok: false, status: 403, body: { error: "company_id not in caller's scope" } };
  }
  return { ok: true };
}

// Enable logger
app.use('*', logger(console.log));

// Enable CORS for all routes and methods
app.use(
  "/*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
  }),
);

// ─── KV Key Constants ────────────────────────────────────
const KV_AI_API_KEY = "ai_config:api_key";
const KV_AI_MODEL = "ai_config:model";
const KV_AI_IMPORT_MODEL = "ai_config:import_model";
const KV_AI_SETTINGS_PREFIX = "ai_config:";
const KV_PREFS_PREFIX = "agent_prefs:";
const KV_CHAT_PREFIX = "ask_ai_chat:";
const KV_INBOX_LIST = "inbox_connections";
const KV_INBOX_TOKEN_PREFIX = "inbox_token:";
const DEFAULT_AI_MODEL = "google/gemini-2.5-flash-lite";

// ─── Health Check ────────────────────────────────────────
app.get("/make-server-ab702ee0/health", (c) => {
  return c.json({ status: "ok" });
});

// ─── AI Settings: GET ────────────────────────────────────
// Returns the saved AI configuration (API key masked, model name)
app.get("/make-server-ab702ee0/ai/settings", async (c) => {
  try {
    const [apiKey, model, importModel] = await Promise.all([
      kv.get(KV_AI_API_KEY),
      kv.get(KV_AI_MODEL),
      kv.get(KV_AI_IMPORT_MODEL),
    ]);

    const rawKey = typeof apiKey === "string" ? apiKey : "";
    const maskedKey = rawKey
      ? `${rawKey.slice(0, 8)}...${rawKey.slice(-4)}`
      : "";

    return c.json({
      hasApiKey: !!rawKey,
      maskedApiKey: maskedKey,
      model: (typeof model === "string" ? model : "") || DEFAULT_AI_MODEL,
      importModel: (typeof importModel === "string" ? importModel : "") || "google/gemini-3.1-flash-lite-preview",
    });
  } catch (err: any) {
    console.log(`Error fetching AI settings: ${err.message}`);
    return c.json({ error: `Failed to load AI settings: ${err.message}` }, 500);
  }
});

// ─── AI Settings: PUT ────────────────────────────────────
// Save or update AI configuration
app.put("/make-server-ab702ee0/ai/settings", async (c) => {
  try {
    const body = await c.req.json();
    const { apiKey, model, importModel } = body;

    const keys: string[] = [];
    const values: any[] = [];

    if (typeof apiKey === "string") {
      keys.push(KV_AI_API_KEY);
      values.push(apiKey);
    }

    if (typeof model === "string" && model.trim()) {
      keys.push(KV_AI_MODEL);
      values.push(model.trim());
    }

    if (typeof importModel === "string" && importModel.trim()) {
      keys.push(KV_AI_IMPORT_MODEL);
      values.push(importModel.trim());
    }

    if (keys.length === 0) {
      return c.json({ error: "No valid fields to update" }, 400);
    }

    await kv.mset(keys, values);

    // Return current state
    const savedKey = typeof apiKey === "string" ? apiKey : (await kv.get(KV_AI_API_KEY) || "");
    const savedModel = typeof model === "string" ? model : (await kv.get(KV_AI_MODEL) || DEFAULT_AI_MODEL);
    const savedImportModel = typeof importModel === "string" ? importModel : (await kv.get(KV_AI_IMPORT_MODEL) || "google/gemini-3.1-flash-lite-preview");
    const maskedKey = savedKey
      ? `${savedKey.slice(0, 8)}...${savedKey.slice(-4)}`
      : "";

    return c.json({
      hasApiKey: !!savedKey,
      maskedApiKey: maskedKey,
      model: savedModel,
      importModel: savedImportModel,
    });
  } catch (err: any) {
    console.log(`Error saving AI settings: ${err.message}`);
    return c.json({ error: `Failed to save AI settings: ${err.message}` }, 500);
  }
});

// ─── AI Settings: DELETE (clear API key) ─────────────────
app.delete("/make-server-ab702ee0/ai/settings/key", async (c) => {
  try {
    await kv.set(KV_AI_API_KEY, "");
    return c.json({ hasApiKey: false, maskedApiKey: "", model: (await kv.get(KV_AI_MODEL)) || DEFAULT_AI_MODEL });
  } catch (err: any) {
    console.log(`Error clearing API key: ${err.message}`);
    return c.json({ error: `Failed to clear API key: ${err.message}` }, 500);
  }
});

// ─── Agent Preferences: GET ──────────────────────────────
// Returns all saved agent preferences (devMode, agentName, etc.)
app.get("/make-server-ab702ee0/preferences", async (c) => {
  try {
    const prefKeys = ["devMode", "agentName", "darkMode", "defaultLanguage", "hostSettings", "ticketState", "properties", "promptOverrides", "notificationPrefs"];
    const results = await Promise.all(
      prefKeys.map(k => kv.get(`${KV_PREFS_PREFIX}${k}`))
    );

    const prefs: Record<string, any> = {};
    for (let i = 0; i < prefKeys.length; i++) {
      if (results[i] !== undefined && results[i] !== null) {
        prefs[prefKeys[i]] = results[i];
      }
    }
    return c.json(prefs);
  } catch (err: any) {
    console.log(`Error fetching agent preferences: ${err.message}`);
    return c.json({ error: `Failed to load preferences: ${err.message}` }, 500);
  }
});

// ─── Agent Preferences: PUT ──────────────────────────────
// Save agent preferences — accepts any key/value pairs
app.put("/make-server-ab702ee0/preferences", async (c) => {
  try {
    const body = await c.req.json();
    const keys: string[] = [];
    const values: any[] = [];

    for (const [key, value] of Object.entries(body)) {
      keys.push(`${KV_PREFS_PREFIX}${key}`);
      values.push(value);
    }

    if (keys.length === 0) {
      return c.json({ error: "No preferences to save" }, 400);
    }

    await kv.mset(keys, values);
    return c.json({ saved: Object.keys(body) });
  } catch (err: any) {
    console.log(`Error saving agent preferences: ${err.message}`);
    return c.json({ error: `Failed to save preferences: ${err.message}` }, 500);
  }
});

// ─── OpenRouter Proxy: Compose Reply ─────────────────────
// Proxies the AI call through the server so the API key never reaches the client
app.post("/make-server-ab702ee0/ai/compose-reply", async (c) => {
  try {
    const apiKey = await kv.get(KV_AI_API_KEY);
    if (!apiKey) {
      return c.json({ error: "No API key configured. Go to Settings > AI Configuration to add one." }, 400);
    }

    const body = await c.req.json();
    const { systemPrompt, userPrompt, model, temperature, maxTokens } = body;

    if (!systemPrompt || !userPrompt) {
      return c.json({ error: "Missing required fields: systemPrompt, userPrompt" }, 400);
    }

    const aiModel = model || (await kv.get(KV_AI_MODEL)) || DEFAULT_AI_MODEL;
    const startMs = performance.now();

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-Title": "Hospitality BPO Platform",
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: temperature ?? 0.7,
        max_tokens: maxTokens ?? 1024,
      }),
    });

    const durationMs = Math.round(performance.now() - startMs);
    const json = await res.json();

    if (!res.ok) {
      const errMsg = json?.error?.message || JSON.stringify(json);
      console.log(`OpenRouter API error (compose-reply): ${res.status} ${errMsg}`);
      return c.json({
        error: errMsg,
        status: res.status,
        durationMs,
        model: aiModel,
      }, res.status);
    }

    const text = json.choices?.[0]?.message?.content || "";
    const usage = json.usage
      ? {
          prompt: json.usage.prompt_tokens ?? 0,
          completion: json.usage.completion_tokens ?? 0,
          total: json.usage.total_tokens ?? 0,
        }
      : null;

    return c.json({
      text,
      tokensUsed: usage,
      model: aiModel,
      durationMs,
      status: res.status,
    });
  } catch (err: any) {
    console.log(`Network error in compose-reply proxy: ${err.message}`);
    return c.json({ error: `Network error: ${err.message}` }, 502);
  }
});

// ─── OpenRouter Proxy: Ask AI ────────────────────────────
app.post("/make-server-ab702ee0/ai/ask", async (c) => {
  try {
    const apiKey = await kv.get(KV_AI_API_KEY);
    if (!apiKey) {
      return c.json({ error: "No API key configured. Go to Settings > AI Configuration to add one." }, 400);
    }

    const body = await c.req.json();
    const { systemPrompt, userPrompt, model, temperature, maxTokens } = body;

    if (!systemPrompt || !userPrompt) {
      return c.json({ error: "Missing required fields: systemPrompt, userPrompt" }, 400);
    }

    const aiModel = model || (await kv.get(KV_AI_MODEL)) || DEFAULT_AI_MODEL;
    const startMs = performance.now();

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "X-Title": "Hospitality BPO Platform",
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: temperature ?? 0.5,
        max_tokens: maxTokens ?? 512,
      }),
    });

    const durationMs = Math.round(performance.now() - startMs);
    const json = await res.json();

    if (!res.ok) {
      const errMsg = json?.error?.message || JSON.stringify(json);
      console.log(`OpenRouter API error (ask-ai): ${res.status} ${errMsg}`);
      return c.json({
        error: errMsg,
        status: res.status,
        durationMs,
        model: aiModel,
      }, res.status);
    }

    const text = json.choices?.[0]?.message?.content || "";
    const usage = json.usage
      ? {
          prompt: json.usage.prompt_tokens ?? 0,
          completion: json.usage.completion_tokens ?? 0,
          total: json.usage.total_tokens ?? 0,
        }
      : null;

    return c.json({
      text,
      tokensUsed: usage,
      model: aiModel,
      durationMs,
      status: res.status,
    });
  } catch (err: any) {
    console.log(`Network error in ask-ai proxy: ${err.message}`);
    return c.json({ error: `Network error: ${err.message}` }, 502);
  }
});

// ─── AI Auto-Reply: Claim idempotency row ────────────────
// Server-side gate for AI auto-replies. Every tab that sees a new guest
// message calls this; the UNIQUE PK on (company_id, thread_key,
// guest_msg_id) ensures exactly one client wins.
//
// Winners proceed to call /ai/compose-reply and then /ai/auto-reply/finalize.
// Losers receive { won: false, existing: {...} } and render the winner's
// result from Realtime once the finalize lands.
app.post("/make-server-ab702ee0/ai/auto-reply/claim", async (c) => {
  try {
    const body = await c.req.json();
    const { company_id, thread_key, guest_msg_id, prompt_version, model } = body;

    if (!company_id || !thread_key || !guest_msg_id || !prompt_version || !model) {
      return c.json({ error: "Missing required fields: company_id, thread_key, guest_msg_id, prompt_version, model" }, 400);
    }

    const auth = await requireCompanyId(c, company_id);
    if (!auth.ok) return c.json(auth.body as any, auth.status as any);

    const db = dbClient();

    // Try to claim the attempt. PK collision = someone else won.
    const insert = await db
      .from("ai_reply_attempts")
      .insert({
        company_id,
        thread_key,
        guest_msg_id,
        prompt_version,
        model,
        outcome: "pending",
      })
      .select("trace_id")
      .maybeSingle();

    if (!insert.error && insert.data) {
      return c.json({ won: true, trace_id: insert.data.trace_id, existing: null });
    }

    // 23505 = unique_violation. Anything else is a real error.
    const code = (insert.error as { code?: string } | null)?.code;
    if (code !== "23505") {
      console.log(`[auto-reply/claim] insert failed:`, insert.error);
      return c.json({ error: insert.error?.message || "insert failed" }, 500);
    }

    // Lost the race — return the winner's current state so the loser can
    // either render it immediately (if finalized) or wait on Realtime.
    const { data: existing, error: selErr } = await db
      .from("ai_reply_attempts")
      .select("trace_id, outcome, reply_text, risk_score, model, prompt_version, created_at, completed_at")
      .eq("company_id", company_id)
      .eq("thread_key", thread_key)
      .eq("guest_msg_id", guest_msg_id)
      .maybeSingle();

    if (selErr || !existing) {
      return c.json({ error: "claim conflict but row not readable" }, 500);
    }

    // Stale-pending reclaim: if the existing row is still 'pending' but
    // its owning tab hasn't finalized within the LLM-call budget (5 min),
    // the tab probably crashed / lost network / was force-closed. Take
    // it over by transitioning pending→pending with a fresh prompt_version
    // + model stamp (represents "new claimant"). Conditional UPDATE
    // ensures we only win if nobody else finalized first.
    const STALE_PENDING_MS = 5 * 60 * 1000;
    const createdAtMs = Date.parse(existing.created_at as unknown as string);
    if (existing.outcome === "pending" && Number.isFinite(createdAtMs) && Date.now() - createdAtMs > STALE_PENDING_MS) {
      const reclaim = await db
        .from("ai_reply_attempts")
        .update({
          prompt_version,
          model,
          // Reset created_at so the TTL check restarts for the new claimant.
          created_at: new Date().toISOString(),
        })
        .eq("company_id", company_id)
        .eq("thread_key", thread_key)
        .eq("guest_msg_id", guest_msg_id)
        .eq("outcome", "pending")
        .select("trace_id")
        .maybeSingle();

      if (!reclaim.error && reclaim.data) {
        console.log(`[auto-reply/claim] reclaimed stale pending row for ${thread_key}:${guest_msg_id}`);
        return c.json({ won: true, trace_id: reclaim.data.trace_id, existing: null, reclaimed: true });
      }
      // If reclaim failed because someone finalized between our SELECT
      // and UPDATE, fall through to returning existing normally.
    }

    return c.json({ won: false, trace_id: existing.trace_id, existing });
  } catch (err: any) {
    console.log(`[auto-reply/claim] error: ${err.message}`);
    return c.json({ error: err.message }, 500);
  }
});

// ─── AI Auto-Reply: Finalize with outcome ────────────────
// Called by the winning tab after the LLM returns. Client is expected to
// do a commit-time tail check BEFORE calling this — if a non-guest
// message landed while the LLM was thinking, the client sends
// outcome='superseded' and omits reply_text.
app.post("/make-server-ab702ee0/ai/auto-reply/finalize", async (c) => {
  try {
    const body = await c.req.json();
    const { company_id, thread_key, guest_msg_id, outcome, reply_text, risk_score } = body;

    if (!company_id || !thread_key || !guest_msg_id || !outcome) {
      return c.json({ error: "Missing required fields: company_id, thread_key, guest_msg_id, outcome" }, 400);
    }

    const VALID_OUTCOMES = ["answered", "partial", "escalate", "safety", "superseded", "error"];
    if (!VALID_OUTCOMES.includes(outcome)) {
      return c.json({ error: `Invalid outcome. Must be one of: ${VALID_OUTCOMES.join(", ")}` }, 400);
    }

    const auth = await requireCompanyId(c, company_id);
    if (!auth.ok) return c.json(auth.body as any, auth.status as any);

    const db = dbClient();

    const { data, error } = await db
      .from("ai_reply_attempts")
      .update({
        outcome,
        reply_text: reply_text ?? null,
        risk_score: typeof risk_score === "number" ? risk_score : null,
        completed_at: new Date().toISOString(),
      })
      .eq("company_id", company_id)
      .eq("thread_key", thread_key)
      .eq("guest_msg_id", guest_msg_id)
      .eq("outcome", "pending")  // only finalize from pending → terminal
      .select("trace_id, outcome, reply_text, risk_score")
      .maybeSingle();

    if (error) {
      console.log(`[auto-reply/finalize] update failed:`, error);
      return c.json({ error: error.message }, 500);
    }

    // If data is null, the row was already finalized by someone else or
    // never claimed. Return 200 with `already_finalized: true` so the
    // client can safely treat it as a no-op.
    if (!data) {
      const { data: current } = await db
        .from("ai_reply_attempts")
        .select("trace_id, outcome, reply_text, risk_score")
        .eq("company_id", company_id)
        .eq("thread_key", thread_key)
        .eq("guest_msg_id", guest_msg_id)
        .maybeSingle();
      return c.json({ already_finalized: true, current });
    }

    return c.json({ already_finalized: false, current: data });
  } catch (err: any) {
    console.log(`[auto-reply/finalize] error: ${err.message}`);
    return c.json({ error: err.message }, 500);
  }
});

// ─── Ask AI Chat History: GET ────────────────────────────
// Returns saved chat messages for a specific ticket
app.get("/make-server-ab702ee0/ai/chat/:ticketId", async (c) => {
  try {
    const ticketId = c.req.param("ticketId");
    if (!ticketId) {
      return c.json({ error: "Missing ticketId" }, 400);
    }
    const data = await kv.get(`${KV_CHAT_PREFIX}${ticketId}`);
    const messages = data ? (typeof data === "string" ? JSON.parse(data) : data) : [];
    return c.json({ ticketId, messages });
  } catch (err: any) {
    console.log(`Error fetching chat history for ticket: ${err.message}`);
    return c.json({ error: `Failed to load chat history: ${err.message}` }, 500);
  }
});

// ─── Ask AI Chat History: PUT ────────────────────────────
// Saves (overwrites) chat messages for a specific ticket
app.put("/make-server-ab702ee0/ai/chat/:ticketId", async (c) => {
  try {
    const ticketId = c.req.param("ticketId");
    if (!ticketId) {
      return c.json({ error: "Missing ticketId" }, 400);
    }
    const body = await c.req.json();
    const messages = body.messages || [];
    await kv.set(`${KV_CHAT_PREFIX}${ticketId}`, JSON.stringify(messages));
    return c.json({ ticketId, saved: messages.length });
  } catch (err: any) {
    console.log(`Error saving chat history: ${err.message}`);
    return c.json({ error: `Failed to save chat history: ${err.message}` }, 500);
  }
});

// ─── Ask AI Chat History: DELETE ─────────────────────────
// Clears chat messages for a specific ticket
app.delete("/make-server-ab702ee0/ai/chat/:ticketId", async (c) => {
  try {
    const ticketId = c.req.param("ticketId");
    if (!ticketId) {
      return c.json({ error: "Missing ticketId" }, 400);
    }
    await kv.del(`${KV_CHAT_PREFIX}${ticketId}`);
    return c.json({ ticketId, cleared: true });
  } catch (err: any) {
    console.log(`Error clearing chat history: ${err.message}`);
    return c.json({ error: `Failed to clear chat history: ${err.message}` }, 500);
  }
});


// ─── Onboarding Form Data ────────────────────────────────
app.post("/make-server-ab702ee0/onboarding/save", async (c) => {
  try {
    const data = await c.req.json();
    if (!data || typeof data !== 'object') {
      return c.json({ error: 'Invalid data' }, 400);
    }

    // Save each property's form data
    for (const [propId, formData] of Object.entries(data)) {
      await kv.set(`onboarding_form:${propId}`, JSON.stringify(formData));
    }

    return c.json({ ok: true });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

app.get("/make-server-ab702ee0/onboarding/load", async (c) => {
  try {
    // Retrieve all property IDs that have onboarding data stored
    const propIds = c.req.query('propIds');
    if (!propIds) return c.json({ data: {} });

    const ids = propIds.split(',').filter(Boolean);
    const result: Record<string, unknown> = {};
    for (const propId of ids) {
      const raw = await kv.get(`onboarding_form:${propId}`);
      if (raw) {
        try { result[propId] = JSON.parse(raw as string); } catch {}
      }
    }
    return c.json({ data: result });
  } catch (error: any) {
    return c.json({ error: error.message }, 500);
  }
});

// ─── Connected Inboxes: GET ─────────────────────────────
// Returns saved inbox connections (tokens masked — never sent to client)
app.get("/make-server-ab702ee0/inboxes", async (c) => {
  try {
    const data = await kv.get(KV_INBOX_LIST);
    const inboxes = Array.isArray(data) ? data : [];
    return c.json({ inboxes });
  } catch (err: any) {
    console.log(`Error fetching inboxes: ${err.message}`);
    return c.json({ error: `Failed to load inboxes: ${err.message}` }, 500);
  }
});

// ─── Connected Inboxes: GET token for a specific host ───
// Returns the full access token for a single host (used by AppContext on init)
app.get("/make-server-ab702ee0/inboxes/:hostId/token", async (c) => {
  try {
    const hostId = c.req.param("hostId");
    const token = await kv.get(`${KV_INBOX_TOKEN_PREFIX}${hostId}`);
    if (!token) {
      return c.json({ error: "Token not found" }, 404);
    }
    return c.json({ hostId, token });
  } catch (err: any) {
    console.log(`Error fetching inbox token: ${err.message}`);
    return c.json({ error: `Failed to load token: ${err.message}` }, 500);
  }
});

// ─── Connected Inboxes: GET all tokens ──────────────────
// Bulk-fetch tokens for multiple hosts (used on app init)
app.post("/make-server-ab702ee0/inboxes/tokens", async (c) => {
  try {
    const { hostIds } = await c.req.json();
    if (!Array.isArray(hostIds) || hostIds.length === 0) {
      return c.json({ tokens: {} });
    }
    const keys = hostIds.map((id: string) => `${KV_INBOX_TOKEN_PREFIX}${id}`);
    const values = await kv.mget(keys);
    const tokens: Record<string, string> = {};
    for (let i = 0; i < hostIds.length; i++) {
      if (values[i]) tokens[hostIds[i]] = values[i];
    }
    return c.json({ tokens });
  } catch (err: any) {
    console.log(`Error fetching inbox tokens: ${err.message}`);
    return c.json({ error: `Failed to load tokens: ${err.message}` }, 500);
  }
});

// ─── Connected Inboxes: PUT (add/update) ────────────────
// Saves a new connection — stores metadata in list + token separately
app.put("/make-server-ab702ee0/inboxes/:hostId", async (c) => {
  try {
    const hostId = c.req.param("hostId");
    const { companyName, maskedToken, connectedAt, accessToken } = await c.req.json();

    if (!companyName || !accessToken) {
      return c.json({ error: "Missing required fields: companyName, accessToken" }, 400);
    }

    // 1. Update the connections list (add or replace entry for this hostId)
    const existing = await kv.get(KV_INBOX_LIST);
    const inboxes: any[] = Array.isArray(existing) ? existing : [];
    const filtered = inboxes.filter((i: any) => i.hostId !== hostId);
    filtered.push({
      hostId,
      companyName,
      maskedToken: maskedToken || "",
      connectedAt: connectedAt || new Date().toISOString(),
    });

    // 2. Save both the list and the token
    await kv.mset(
      [KV_INBOX_LIST, `${KV_INBOX_TOKEN_PREFIX}${hostId}`],
      [filtered, accessToken],
    );

    return c.json({ saved: true, hostId });
  } catch (err: any) {
    console.log(`Error saving inbox: ${err.message}`);
    return c.json({ error: `Failed to save inbox: ${err.message}` }, 500);
  }
});

// ─── Connected Inboxes: DELETE ──────────────────────────
// Removes a connection by hostId (both metadata + token)
app.delete("/make-server-ab702ee0/inboxes/:hostId", async (c) => {
  try {
    const hostId = c.req.param("hostId");

    // 1. Remove from the connections list
    const existing = await kv.get(KV_INBOX_LIST);
    const inboxes: any[] = Array.isArray(existing) ? existing : [];
    const filtered = inboxes.filter((i: any) => i.hostId !== hostId);
    await kv.set(KV_INBOX_LIST, filtered);

    // 2. Delete the token
    await kv.del(`${KV_INBOX_TOKEN_PREFIX}${hostId}`);

    return c.json({ deleted: true, hostId });
  } catch (err: any) {
    console.log(`Error deleting inbox: ${err.message}`);
    return c.json({ error: `Failed to delete inbox: ${err.message}` }, 500);
  }
});

Deno.serve(app.fetch);