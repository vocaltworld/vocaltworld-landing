const crypto = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
).trim();

const ADMIN_RESET_SECRET = String(process.env.ADMIN_RESET_SECRET || "").trim();
const ADMIN_RESET_EMAIL = String(process.env.ADMIN_RESET_EMAIL || "").trim();

// ✅ REAL Supabase tables (reset ONLY responses, not token logs)
const SURVEY_SUBMISSIONS_TABLE = "survey_submissions";
const MICRO_POLL_RESPONSES_TABLE = "micro_poll_responses";

async function supabaseGet(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function supabasePatch(path, body) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "PATCH",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function supabaseDelete(path) {
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "DELETE",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase error ${res.status}: ${text}`);
  return true;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function base64urlToString(b64url) {
  const b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

function signJwt(secret, signingInput) {
  const digest = crypto.createHmac("sha256", secret).update(signingInput).digest("base64");
  return digest.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function safeEqual(a, b) {
  const sa = String(a);
  const sb = String(b);
  if (sa.length !== sb.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sa), Buffer.from(sb));
}

function verifyJwtHS256(secret, token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) return { ok: false, error: "invalid_token_format" };
  const [h, p, s] = parts;
  const signingInput = `${h}.${p}`;
  const expected = signJwt(secret, signingInput);
  if (!safeEqual(s, expected)) return { ok: false, error: "invalid_token" };

  let decoded = null;
  try { decoded = JSON.parse(base64urlToString(p)); } catch {}
  if (!decoded) return { ok: false, error: "invalid_token_payload" };
  return { ok: true, decoded };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return json(405, { ok: false, error: "Method not allowed" });
    }
    if (!ADMIN_RESET_SECRET) return json(500, { ok: false, error: "Missing ADMIN_RESET_SECRET" });
    if (!ADMIN_RESET_EMAIL) return json(500, { ok: false, error: "Missing ADMIN_RESET_EMAIL" });
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const qs = event.queryStringParameters || {};
    let payload = {};
    if (event.httpMethod === "POST") {
      try { payload = event.body ? JSON.parse(event.body) : {}; } catch { payload = {}; }
    }

    const token = String(qs.token || payload.token || "").trim();
    if (!token) return json(400, { ok: false, error: "Missing token" });

    const v = verifyJwtHS256(ADMIN_RESET_SECRET, token);
    if (!v.ok) return json(401, { ok: false, error: v.error });

    const email = String(v.decoded?.e || "").trim().toLowerCase();
    const token_id = String(v.decoded?.t || "").trim();
    const exp = Number(v.decoded?.exp || 0);
    const purpose = String(v.decoded?.p || "").trim();

    if (!email || !token_id || !purpose) return json(400, { ok: false, error: "token_missing_fields" });
    if (email !== ADMIN_RESET_EMAIL.toLowerCase()) return json(403, { ok: false, error: "not_allowed" });
    if (exp && Date.now() > exp) return json(401, { ok: false, error: "token_expired" });
    if (purpose !== "reset_responses") return json(400, { ok: false, error: "invalid_purpose" });

    // 1) controlla richiesta in DB (one-time)
    const rows = await supabaseGet(
      `/rest/v1/admin_reset_requests?select=id,token_id,status,expires_at,created_at,executed_at&token_id=eq.${encodeURIComponent(token_id)}&limit=1`
    );
    if (!Array.isArray(rows) || !rows.length) return json(404, { ok: false, error: "request_not_found" });

    const req = rows[0];
    if (req.status !== "pending") return json(400, { ok: false, error: "already_used" });

    if (req.expires_at) {
      const expDb = Date.parse(String(req.expires_at));
      if (!Number.isNaN(expDb) && Date.now() > expDb) {
        // Mark as expired (best effort) and stop
        try {
          await supabasePatch(
            `/rest/v1/admin_reset_requests?token_id=eq.${encodeURIComponent(token_id)}`,
            { status: "expired" }
          );
        } catch {}

        return json(401, { ok: false, error: "token_expired" });
      }
    }

    // 2) ✅ delete SOLO risposte (no token logs)
    // PostgREST richiede un filtro per DELETE. Usiamo created_at=not.is.null per eliminare tutte le righe.
    await supabaseDelete(`/rest/v1/${SURVEY_SUBMISSIONS_TABLE}?created_at=not.is.null`);
    await supabaseDelete(`/rest/v1/${MICRO_POLL_RESPONSES_TABLE}?created_at=not.is.null`);

    // 3) marca executed
    await supabasePatch(`/rest/v1/admin_reset_requests?token_id=eq.${encodeURIComponent(token_id)}`, {
      status: "executed",
      executed_at: new Date().toISOString(),
    });

    return json(200, { ok: true, message: "Responses reset completed" });
  } catch (err) {
    return json(500, { ok: false, error: "Internal error", message: err?.message || String(err) });
  }
};