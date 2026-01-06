const crypto = require("crypto");

const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
).trim();

const ADMIN_RESET_EMAIL = String(process.env.ADMIN_RESET_EMAIL || "resetdatabasevocaltworld@gmail.com").trim(); // la TUA email (fallback sicuro)
const ADMIN_RESET_SECRET = String(process.env.ADMIN_RESET_SECRET || "").trim();
const PUBLIC_BASE_URL = String(process.env.PUBLIC_BASE_URL || "https://survey.vocaltworld.com").trim();

const KLAVIYO_PRIVATE_API_KEY = String(process.env.KLAVIYO_PRIVATE_API_KEY || process.env.KLAVIYO_API_KEY || "").trim();
const KLAVIYO_REVISION = String(process.env.KLAVIYO_REVISION || "2023-10-15").trim();
const KLAVIYO_METRIC_NAME = String(process.env.KLAVIYO_ADMIN_RESET_METRIC || "Admin Reset Confirmation").trim();

// Invio email via Klaviyo: creiamo un EVENTO su un profilo (email) e una Flow in Klaviyo invierà la mail.
// In Klaviyo crea una Flow triggerata dal metric name `Admin Reset Confirmation` (o variabile env).
// Nel template usa `{{ event.properties.confirm_url }}` come link.
async function sendEmail({ to, subject, html, confirmUrl }) {
  if (!KLAVIYO_PRIVATE_API_KEY) {
    throw new Error("Missing KLAVIYO_PRIVATE_API_KEY (or KLAVIYO_API_KEY)");
  }

  const payload = {
    data: {
      type: "event",
      attributes: {
        profile: {
          data: {
            type: "profile",
            attributes: {
              email: to,
            },
          },
        },
        metric: {
          data: {
            type: "metric",
            attributes: {
              name: KLAVIYO_METRIC_NAME,
            },
          },
        },
        properties: {
          subject,
          html,
          confirm_url: confirmUrl,
          public_base_url: PUBLIC_BASE_URL,
          purpose: "reset_responses",
        },
        time: new Date().toISOString(),
      },
    },
  };

  const res = await fetch("https://a.klaviyo.com/api/events/", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      revision: KLAVIYO_REVISION,
      Authorization: `Klaviyo-API-Key ${KLAVIYO_PRIVATE_API_KEY}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const msg = typeof data === "string" ? data : JSON.stringify(data);
    throw new Error(`Klaviyo error ${res.status}: ${msg}`);
  }

  return data;
}

async function supabasePost(path, body) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    method: "POST",
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

function corsHeaders(origin) {
  const allowlist = new Set([
    "https://survey.vocaltworld.com",
    "https://www.survey.vocaltworld.com",
    "http://localhost:5173",
    "http://localhost:8888",
  ]);

  const o = String(origin || "").trim();
  const allowedOrigin = allowlist.has(o) ? o : "https://survey.vocaltworld.com";

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

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

function base64url(input) {
  return Buffer.from(input).toString("base64").replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function signJwt(secret, signingInput) {
  const digest = crypto.createHmac("sha256", secret).update(signingInput).digest("base64");
  return digest.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin;
  const headers = corsHeaders(origin);

  try {
    if (event.httpMethod === "OPTIONS") return json(204, undefined, headers);

    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" }, headers);

    if (!ADMIN_RESET_SECRET) return json(500, { ok: false, error: "Missing ADMIN_RESET_SECRET" }, headers);
    if (!ADMIN_RESET_EMAIL) return json(500, { ok: false, error: "Missing ADMIN_RESET_EMAIL" }, headers);

    let payload = {};
    try { payload = event.body ? JSON.parse(event.body) : {}; } catch { payload = {}; }

    // hard gate: una admin key (semplice ma efficace)
    const adminKey = String(payload.admin_key || "").trim();
    const expectedKey = String(process.env.ADMIN_DASH_KEY || "").trim();
    if (!expectedKey) return json(500, { ok: false, error: "Missing ADMIN_DASH_KEY" }, headers);
    if (!adminKey || adminKey !== expectedKey) return json(401, { ok: false, error: "Unauthorized" }, headers);

    // crea token id + scadenza breve
    const token_id = crypto.randomBytes(16).toString("hex");
    const expMs = Date.now() + 10 * 60 * 1000; // 10 minuti
    const expires_at = new Date(expMs).toISOString();

    // salva richiesta su DB (pending)
    await supabasePost("/rest/v1/admin_reset_requests", [{
      token_id,
      purpose: "reset_responses",
      status: "pending",
      expires_at,
      requested_by: ADMIN_RESET_EMAIL,
      request_ip: String(event.headers?.["x-forwarded-for"] || event.headers?.["client-ip"] || "").split(",")[0].trim(),
    }]);

    // crea JWT (one-time verrà garantito dalla tabella)
    const headerB64 = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payloadB64 = base64url(JSON.stringify({
      e: ADMIN_RESET_EMAIL,
      t: token_id,
      exp: expMs,
      p: "reset_responses",
    }));
    const signingInput = `${headerB64}.${payloadB64}`;
    const sig = signJwt(ADMIN_RESET_SECRET, signingInput);
    const token = `${signingInput}.${sig}`;

    const confirmUrl = `${PUBLIC_BASE_URL}/admin/reset-confirm?token=${encodeURIComponent(token)}`;

    // email HTML minimale (poi la renderizzi come vuoi tu)
    const subject = "Conferma reset risposte (Vocal T World)";
    const html = `
      <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;padding:18px;">
        <h2>Conferma reset risposte</h2>
        <p>Hai richiesto di svuotare <b>SOLO le risposte</b> (sondaggio principale + micro sondaggi).</p>
        <p>Questo link è valido per <b>10 minuti</b> e si può usare una sola volta.</p>
        <p>
          <a href="${confirmUrl}" style="display:inline-block;padding:12px 18px;border-radius:10px;background:#111;color:#fff;text-decoration:none;font-weight:700;">
            Conferma reset
          </a>
        </p>
        <p style="color:#666;font-size:12px;">Se non sei stato tu, ignora questa email.</p>
      </div>
    `;

    await sendEmail({ to: ADMIN_RESET_EMAIL, subject, html, confirmUrl });

    return json(200, { ok: true, message: "Confirmation email sent" }, headers);
  } catch (err) {
    return json(500, { ok: false, error: "Internal error", message: err?.message || String(err) }, headers);
  }
};