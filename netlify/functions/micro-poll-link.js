const crypto = require("crypto");

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

function redirect(statusCode, location, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      Location: location,
      "Cache-Control": "no-store",
      ...extraHeaders,
    },
    body: "",
  };
}

function base64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlToString(b64url) {
  const b64 = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

function sign(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function normalizeEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s || !s.includes("@") || s.length > 320) return "";
  return s;
}

function corsHeaders(origin) {
  // In produzione lascia passare solo i tuoi domini (e localhost per dev)
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };
}

function sanitizeRedirectBase(input) {
  const raw = String(input || "").trim();
  const allow = new Set([
    "https://survey.vocaltworld.com",
    "https://www.survey.vocaltworld.com",
    "http://localhost:5173",
    "http://localhost:8888",
  ]);

  if (allow.has(raw)) return raw;
  // fallback sicuro
  return "https://survey.vocaltworld.com";
}

exports.handler = async (event) => {
  const origin = event?.headers?.origin || event?.headers?.Origin;

  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
      return json(204, undefined, corsHeaders(origin));
    }

    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return json(405, { ok: false, error: "Method not allowed" }, corsHeaders(origin));
    }

    const MICRO_POLL_SECRET = String(process.env.MICRO_POLL_SECRET || "").trim();
    if (!MICRO_POLL_SECRET) {
      return json(500, { ok: false, error: "Missing MICRO_POLL_SECRET" }, corsHeaders(origin));
    }

    // Accettiamo sia GET querystring che POST body
    const qs = event.queryStringParameters || {};
    let payload = {};
    if (event.httpMethod === "POST") {
      try {
        payload = event.body ? JSON.parse(event.body) : {};
      } catch {
        payload = {};
      }
    }

    const questionId = String(
      payload.question_id ||
        payload.questionId ||
        payload.q ||
        payload.qid ||
        qs.question_id ||
        qs.questionId ||
        qs.q ||
        qs.qid ||
        ""
    ).trim();

    // Email può arrivare come raw o come base64url (consigliato: email_b64url)
    const emailRaw = payload.email || payload.e || qs.email || qs.e;
    const emailB64 = payload.email_b64 || payload.emailB64 || qs.email_b64 || qs.emailB64;
    const emailB64Url = payload.email_b64url || payload.emailB64url || qs.email_b64url || qs.emailB64url;

    let email = "";
    if (emailB64Url) {
      try {
        email = base64urlToString(String(emailB64Url));
      } catch {
        email = "";
      }
    } else if (emailB64) {
      try {
        email = Buffer.from(String(emailB64), "base64").toString("utf8");
      } catch {
        email = "";
      }
    } else {
      email = String(emailRaw || "");
    }

    email = normalizeEmail(email);

    const redirectBase = sanitizeRedirectBase(
      payload.redirect_base ||
        payload.redirectBase ||
        qs.redirect_base ||
        qs.redirectBase ||
        "https://survey.vocaltworld.com"
    );

    if (!questionId) return json(400, { ok: false, error: "Missing question_id" }, corsHeaders(origin));
    if (!email) return json(400, { ok: false, error: "Missing/invalid email" }, corsHeaders(origin));

    // Scadenza token: 7 giorni
    const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;

    const dataObj = { e: email, q: questionId, exp };
    const data = base64url(JSON.stringify(dataObj));
    const sig = sign(MICRO_POLL_SECRET, data);
    const token = `${data}.${sig}`;

    // URL completo della pagina voto (usato solo per redirect)
    const url = `${redirectBase}/poll/${encodeURIComponent(questionId)}?token=${encodeURIComponent(token)}`;

    const headers = corsHeaders(origin);

    // Se è una chiamata GET da email/click, reindirizziamo direttamente alla pagina voto.
    // Se invece vuoi il JSON (fetch da VotePage), usa ?format=json (o POST).
    const format = String(qs.format || qs.f || "").toLowerCase();

    if (event.httpMethod === "GET" && format !== "json") {
      return redirect(302, url, headers);
    }

    // API mode: ritorna SOLO i dati necessari al client
    return json(200, { ok: true, token, exp }, headers);
  } catch (err) {
    return json(
      500,
      { ok: false, error: "Internal error", message: err?.message || String(err) },
      corsHeaders(origin)
    );
  }
};