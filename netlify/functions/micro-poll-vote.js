const crypto = require("crypto");

const SUPABASE_TABLE = "micro_poll_responses";
// Expected columns in public.micro_poll_responses:
// question_id (uuid), choice ('yes'|'no'), token_id (text), email (text), created_at

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

function corsHeaders(origin) {
  // keep permissive for now; you can restrict later like in micro-poll-link.js
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function safeEqual(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa.length !== sb.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sa), Buffer.from(sb));
}

function sign(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function base64urlToString(b64url) {
  const b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

function normalizeChoice(v) {
  const raw = String(v || "").trim().toLowerCase();
  if (raw === "yes" || raw === "y" || raw === "1") return "yes";
  if (raw === "no" || raw === "n" || raw === "2") return "no";
  return "";
}

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin;
  const cors = corsHeaders(origin);

  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") return json(204, undefined, cors);

    if (event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "method_not_allowed" }, cors);
    }

    const MICRO_POLL_SECRET = String(process.env.MICRO_POLL_SECRET || "").trim();
    const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
    const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!MICRO_POLL_SECRET) return json(500, { ok: false, error: "missing_micro_poll_secret" }, cors);
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, error: "missing_supabase_env" }, cors);
    }

    let payload = {};
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { ok: false, error: "invalid_json" }, cors);
    }

    // Accept both token and token_id field names (client-side inconsistencies happen)
    const token = String(payload.token || payload.token_id || payload.tokenId || "").trim();
    if (!token) return json(400, { ok: false, error: "missing_token" }, cors);

    // Small sanity limit (prevents garbage payloads)
    if (token.length > 4096) return json(400, { ok: false, error: "token_too_long" }, cors);

    const choice = normalizeChoice(payload.choice);
    if (!choice) return json(400, { ok: false, error: "invalid_choice" }, cors);

    const [data, sig] = token.split(".");
    if (!data || !sig) return json(400, { ok: false, error: "invalid_token_format" }, cors);

    const expectedSig = sign(MICRO_POLL_SECRET, data);
    if (!safeEqual(sig, expectedSig)) return json(401, { ok: false, error: "invalid_token" }, cors);

    let decoded;
    try {
      decoded = JSON.parse(base64urlToString(data));
    } catch {
      return json(400, { ok: false, error: "invalid_token_payload" }, cors);
    }

    const email = String(decoded?.e || "").trim().toLowerCase();
    const question_id = String(decoded?.q || "").trim();
    const token_id = String(decoded?.t || decoded?.tid || "").trim();
    const exp = Number(decoded?.exp || 0);

    if (!email || !question_id || !token_id || !exp) {
      return json(400, { ok: false, error: "token_missing_fields" }, cors);
    }

    if (Date.now() > exp) return json(401, { ok: false, error: "token_expired" }, cors);

    // Optional: if client sends question_id, it MUST match the token (anti-tampering)
    const clientQ = String(payload.question_id || payload.questionId || "").trim();
    if (clientQ && clientQ !== question_id) {
      return json(400, { ok: false, error: "question_mismatch" }, cors);
    }

    const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`;

    const insertRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        // We WANT a 409 on duplicate (unique index on question_id + token_id)
        Prefer: "return=representation",
      },
      body: JSON.stringify({ question_id, choice, token_id, email }),
    });

    const insertData = await insertRes.json().catch(() => null);

    if (!insertRes.ok) {
      // With unique index (question_id, token_id) a double vote should be 409.
      const pgCode = insertData && (insertData.code || insertData?.details?.code);
      if (insertRes.status === 409 || pgCode === "23505") {
        return json(200, { ok: true, already_voted: true }, cors);
      }

      return json(insertRes.status, {
        ok: false,
        error: "supabase_error",
        status: insertRes.status,
        data: insertData,
      }, cors);
    }

    return json(200, { ok: true, saved: true, question_id, choice, token_id }, cors);
  } catch (err) {
    return json(500, { ok: false, error: "internal_error", message: err?.message || String(err) }, cors);
  }
};