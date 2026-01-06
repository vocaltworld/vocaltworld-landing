const crypto = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
// IMPORTANT: this function MUST use the Service Role key (never anon)
const SUPABASE_SERVICE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ""
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

function html(statusCode, htmlBody) {
  return {
    statusCode,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: String(htmlBody || ""),
  };
}

function wantsHtml(event) {
  const accept = String((event.headers && (event.headers.accept || event.headers.Accept)) || "").toLowerCase();
  const qs = event.queryStringParameters || {};
  const format = String(qs.format || "").toLowerCase();
  // Force HTML if explicitly requested
  if (format === "html") return true;
  // Force JSON if explicitly requested
  if (format === "json") return false;
  // Many email clients/browsers send */* or nothing; default to HTML unless JSON is explicitly preferred
  if (!accept || accept.includes("*/*")) return true;
  if (accept.includes("application/json")) return false;
  return accept.includes("text/html");
}

async function supabaseCountAll(table) {
  // Use PostgREST count via Content-Range
  const url = `${SUPABASE_URL}/rest/v1/${table}?select=id&limit=1`;
  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "count=exact",
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Supabase count error ${res.status}: ${text}`);
  const cr = res.headers.get("content-range") || res.headers.get("Content-Range") || "";
  // format is like: "0-0/123" or "*/0"
  const m = cr.match(/\/(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

function renderResultPage({ ok, title, message }) {
  const statusColor = ok ? "#8affc1" : "#ff6b6b";
  const border = ok ? "rgba(0,255,170,0.25)" : "rgba(255,90,90,0.25)";
  return `<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${String(title || "Admin Reset")}</title>
  <style>
    body{margin:0;background:#0b0f14;color:#d1f7ff;font-family:Menlo,Consolas,Monaco,'Courier New',monospace;}
    .wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;}
    .card{max-width:720px;width:100%;background:#020409;border-radius:14px;box-shadow:0 0 0 1px ${border}, 0 20px 60px rgba(0,0,0,.6);overflow:hidden;}
    .head{padding:16px 20px;background:#050a10;border-bottom:1px solid rgba(0,255,255,0.15);}
    .cmd{color:#00eaff;font-size:13px;}
    .cmd b{color:${statusColor};}
    .body{padding:22px 20px 24px 20px;}
    .badge{display:inline-block;padding:6px 10px;border-radius:10px;background:rgba(0,234,255,0.08);border:1px solid rgba(0,234,255,0.18);font-size:12px;}
    .title{margin:14px 0 8px 0;font-size:18px;color:${statusColor};}
    .msg{margin:0;line-height:1.6;color:#bfefff;}
    .hint{margin-top:16px;font-size:12px;color:#7aa3b0;line-height:1.5;}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <div class="head">
        <div class="cmd">vocaltworld@system:~$ <b>${ok ? "reset --executed" : "reset --failed"}</b></div>
      </div>
      <div class="body">
        <span class="badge">Admin Reset · Vocal T World</span>
        <div class="title">${String(title || "")}</div>
        <p class="msg">${String(message || "")}</p>
        <div class="hint">Ora torna alla dashboard admin e premi <b>Aggiorna</b> per ricaricare i conteggi.</div>
      </div>
    </div>
  </div>
</body>
</html>`;
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
    // PostgREST richiede un filtro per DELETE. Usiamo `id=not.is.null` (funziona anche con UUID)
    // così non dipendiamo dal nome della colonna timestamp.
    const beforeSurvey = await supabaseCountAll(SURVEY_SUBMISSIONS_TABLE);
    const beforeMicro = await supabaseCountAll(MICRO_POLL_RESPONSES_TABLE);

    await supabaseDelete(`/rest/v1/${SURVEY_SUBMISSIONS_TABLE}?id=not.is.null`);
    await supabaseDelete(`/rest/v1/${MICRO_POLL_RESPONSES_TABLE}?id=not.is.null`);

    const afterSurvey = await supabaseCountAll(SURVEY_SUBMISSIONS_TABLE);
    const afterMicro = await supabaseCountAll(MICRO_POLL_RESPONSES_TABLE);

    // 3) marca executed
    await supabasePatch(`/rest/v1/admin_reset_requests?token_id=eq.${encodeURIComponent(token_id)}`, {
      status: "executed",
      executed_at: new Date().toISOString(),
      meta: {
        before: { survey_submissions: beforeSurvey, micro_poll_responses: beforeMicro },
        after: { survey_submissions: afterSurvey, micro_poll_responses: afterMicro },
      },
    });

    const payloadOk = {
      ok: true,
      message: "Responses reset completed",
      token_id,
      before: { survey_submissions: beforeSurvey, micro_poll_responses: beforeMicro },
      after: { survey_submissions: afterSurvey, micro_poll_responses: afterMicro },
    };

    if (wantsHtml(event)) {
      return html(200, renderResultPage({
        ok: true,
        title: "Reset completato ✅",
        message: `Risposte eliminate. Prima: survey=${beforeSurvey ?? "?"}, micro=${beforeMicro ?? "?"}. Dopo: survey=${afterSurvey ?? "?"}, micro=${afterMicro ?? "?"}.<br/><br/>Se i numeri non vanno a 0, allora il link sta chiamando la funzione giusta ma il DELETE è stato bloccato (permessi/env). In quel caso controlla i log Netlify della function <b>admin-reset-confirm</b>.`,
      }));
    }

    return json(200, payloadOk);
  } catch (err) {
    const msg = err?.message || String(err);
    const payloadErr = { ok: false, error: "Internal error", message: msg };
    if (wantsHtml(event)) {
      return html(500, renderResultPage({
        ok: false,
        title: "Reset fallito ❌",
        message: msg,
      }));
    }
    return json(500, payloadErr);
  }
};