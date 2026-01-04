
const crypto = require("crypto");

// Node 18+ has global fetch. We use it to read the micro-question from Supabase.
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_KEY = String(
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
).trim();

async function supabaseGet(path) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }
  const res = await fetch(`${SUPABASE_URL}${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
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
    throw new Error(`Supabase error ${res.status}: ${msg}`);
  }
  return data;
}

async function loadMicroQuestion(questionId) {
  // Preferred: multi-choice table
  try {
    const rows = await supabaseGet(
      `/rest/v1/micro_questions_multi?select=id,question,options,active,created_at&id=eq.${encodeURIComponent(
        questionId
      )}&limit=1`
    );
    if (Array.isArray(rows) && rows.length) {
      return { mode: "multi", row: rows[0] };
    }
  } catch (_) {
    // ignore and try legacy
  }

  // Legacy: yes/no table
  const rows2 = await supabaseGet(
    `/rest/v1/micro_questions?select=id,question,option_yes,option_no,active,created_at&id=eq.${encodeURIComponent(
      questionId
    )}&limit=1`
  );
  // Defensive: legacy table must have option_yes/option_no (not option_1..4)
  if (Array.isArray(rows2) && rows2.length) {
    const r = rows2[0];
    if (r && (r.option_yes === undefined || r.option_no === undefined)) {
      throw new Error("Legacy micro_questions schema mismatch: expected option_yes/option_no");
    }
  }
  if (!Array.isArray(rows2) || !rows2.length) {
    return null;
  }
  return { mode: "yn", row: rows2[0] };
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

// Legacy helper (kept in case other code paths need hex signatures)
function signHex(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

// JWT (HS256) signature: base64url( HMAC_SHA256(secret, header.payload) )
function signJwt(secret, signingInput) {
  const digest = crypto.createHmac("sha256", secret).update(signingInput).digest("base64");
  return digest.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function normalizeEmail(v) {
  const s = String(v || "").trim().toLowerCase();
  if (!s || !s.includes("@") || s.length > 320) return "";
  return s;
}

function normalizeFlow(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "listener" || s === "pioneer" || s === "speaker") return s;
  return "speaker";
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

    const flow = normalizeFlow(
      payload.flow ||
        payload.f ||
        qs.flow ||
        qs.f ||
        "speaker"
    );

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

    // Carico la domanda dal DB (serve per evitare errori di colonne e per supportare multi-choice)
    const q = await loadMicroQuestion(questionId);
    if (!q || !q.row) {
      return json(404, { ok: false, error: "Question not found", question_id: questionId }, corsHeaders(origin));
    }
    if (q.row.active === false) {
      return json(400, { ok: false, error: "Question is not active", question_id: questionId }, corsHeaders(origin));
    }
    // Scadenza token: 7 giorni (manteniamo ms per compatibilità con la logica lato vote)
    const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;

    // Token id unico (serve per bloccare doppi voti sullo stesso link)
    const token_id = crypto.randomBytes(16).toString("hex");

    // JWT payload: email (e) + questionId (q) + expiry (exp) + token id (t)
    const headerB64 = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payloadB64 = base64url(JSON.stringify({ e: email, q: questionId, exp, t: token_id, f: flow }));

    const signingInput = `${headerB64}.${payloadB64}`;
    const sigB64 = signJwt(MICRO_POLL_SECRET, signingInput);
    const token = `${signingInput}.${sigB64}`;

    // URL completo della pagina voto (usato solo per redirect)
    const url = `${redirectBase}/poll/${encodeURIComponent(questionId)}?token=${encodeURIComponent(token)}&flow=${encodeURIComponent(flow)}`;

    const headers = corsHeaders(origin);

    // Se è una chiamata GET da email/click, reindirizziamo direttamente alla pagina voto.
    // Se invece vuoi il JSON (fetch da VotePage), usa ?format=json (o POST).
    const format = String(qs.format || "").toLowerCase();

    if (event.httpMethod === "GET" && format !== "json") {
      return redirect(302, url, headers);
    }

    // Normalizzo payload per il client
    const questionText = String(q.row.question || "");
    const options =
      q.mode === "multi"
        ? (Array.isArray(q.row.options) ? q.row.options : [])
        : [String(q.row.option_yes || "Sì"), String(q.row.option_no || "No")];

    return json(
      200,
      {
        ok: true,
        token,
        exp,
        token_id,
        flow,
        question_id: questionId,
        mode: q.mode,
        question: questionText,
        options,
      },
      headers
    );
  } catch (err) {
    return json(
      500,
      { ok: false, error: "Internal error", message: err?.message || String(err) },
      corsHeaders(origin)
    );
  }
};