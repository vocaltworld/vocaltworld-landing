const crypto = require("crypto");

// Node 18+ has global fetch. We use it to read the micro-question from Supabase.
const SUPABASE_URL = String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim();
// IMPORTANT: this Netlify Function must use the Service Role key (server-side) so it can read micro_questions
// even if RLS is enabled. Do NOT fall back to anon keys here.
const SUPABASE_SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

async function supabaseGet(path) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (required for server-side micro-poll-link)");
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
    throw new Error(`Supabase error ${res.status} on ${path}: ${msg}`);
  }
  return data;
}

async function loadMicroQuestion(questionId) {
  // ✅ Tabella: public.micro_questions
  const qid = String(questionId || "").trim();
  if (!qid) return null;
  // PostgREST filter `id=eq.<uuid>` should receive the raw UUID (no encodeURIComponent),
  // otherwise some edge cases can lead to empty results.
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!UUID_RE.test(qid)) return null;

  const rows = await supabaseGet(
    `/rest/v1/micro_questions?select=id,question,kind,options,flow,active,created_at&id=eq.${qid}&limit=1`
  );

  if (!Array.isArray(rows) || !rows.length) return null;

  const row = rows[0] || {};
  const kind = String(row.kind || "").trim().toLowerCase();

  const hasOptionsArray = Array.isArray(row.options) && row.options.length >= 2;

  // ✅ Mappa DB -> mode frontend
  // - multi -> multi
  // - binary -> yn
  // - fallback: se options[] >= 2 => multi altrimenti yn
  const mode = kind === "multi" || (kind !== "binary" && hasOptionsArray) ? "multi" : "yn";

  // Validazione minima
  if (mode === "multi" && !hasOptionsArray) {
    throw new Error("micro_questions schema mismatch: expected options[] (>=2) for kind=multi");
  }

  return { mode, row };
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
// Come normalizeFlow(), ma se non c’è flow valido ritorna "" (NON forza speaker)
function normalizeFlowOptional(v) {
  const s = String(v || "").trim().toLowerCase();
  if (s === "listener" || s === "pioneer" || s === "speaker") return s;
  return "";
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

    // ✅ JSON detection allineato (query/body/header)
    const accept = String(event?.headers?.accept || event?.headers?.Accept || "").toLowerCase();
    const formatParam = String(qs.format || payload.format || "").trim().toLowerCase();
    const wantsJson = formatParam === "json" || accept.includes("application/json");

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

    const flow = normalizeFlow(payload.flow || payload.f || qs.flow || qs.f || "speaker");

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

    // ✅ Shortcut: se arriva già un token, possiamo:
    // - redirect verso /micro?token=...
    // - oppure (json) restituire anche question/mode/options leggendo da Supabase
    const tokenFromQs = String(qs.token || payload.token || "").trim();

    function safeEqual(a, b) {
      const sa = String(a);
      const sb = String(b);
      if (sa.length !== sb.length) return false;
      return crypto.timingSafeEqual(Buffer.from(sa), Buffer.from(sb));
    }

    function base64urlToJson(b64url) {
      try {
        return JSON.parse(base64urlToString(b64url));
      } catch {
        return null;
      }
    }

    function verifyJwtHS256(secret, token) {
      const parts = String(token || "").split(".");
      if (parts.length !== 3) return { ok: false, error: "invalid_token_format" };

      const [h, p, s] = parts;
      if (!h || !p || !s) return { ok: false, error: "invalid_token_format" };

      const signingInput = `${h}.${p}`;
      const expected = signJwt(secret, signingInput);

      if (!safeEqual(s, expected)) return { ok: false, error: "invalid_token" };

      const decoded = base64urlToJson(p);
      if (!decoded) return { ok: false, error: "invalid_token_payload" };

      return { ok: true, decoded };
    }

    if (tokenFromQs) {
      const headers = corsHeaders(origin);

      // Redirect classico (click da email)
      const url = `${redirectBase}/micro?token=${encodeURIComponent(tokenFromQs)}`;
      if (event.httpMethod === "GET" && !wantsJson) {
        return redirect(302, url, headers);
      }

      // JSON: arricchiamo con domanda/opzioni (così il frontend non mostra placeholder)
      const v = verifyJwtHS256(MICRO_POLL_SECRET, tokenFromQs);
      if (!v.ok) return json(401, { ok: false, error: v.error }, headers);

      const questionIdFromToken = String(v.decoded?.q || "").trim();
      const expFromToken = Number(v.decoded?.exp || 0);
      const tokenIdFromToken = String(v.decoded?.t || v.decoded?.tid || "").trim();
      const flowFromToken = normalizeFlowOptional(v.decoded?.f || v.decoded?.flow || "");
      const modeFromToken = String(v.decoded?.m || v.decoded?.mode || "").trim().toLowerCase();

      if (!questionIdFromToken) {
        return json(400, { ok: false, error: "token_missing_fields" }, headers);
      }
      if (expFromToken && Date.now() > expFromToken) {
        return json(401, { ok: false, error: "token_expired" }, headers);
      }

      const q = await loadMicroQuestion(questionIdFromToken);
      if (!q || !q.row) {
        return json(404, { ok: false, error: "Question not found", question_id: questionIdFromToken }, headers);
      }
      if (q.row.active === false) {
        return json(400, { ok: false, error: "Question is not active", question_id: questionIdFromToken }, headers);
      }

      // ✅ Flow e mode devono seguire la domanda (evita mix Speaker/Listener)
      const dbFlow = normalizeFlowOptional(q.row.flow || "");
      const effectiveFlow = dbFlow || flowFromToken || "speaker";
      const effectiveMode = String(q.mode || modeFromToken || "yn").trim().toLowerCase();

      const questionText = String(q.row.question || "");
      const options =
        effectiveMode === "multi"
          ? Array.isArray(q.row.options)
            ? q.row.options
            : []
          : ["Sì", "No"];

      return json(
        200,
        {
          ok: true,
          token: tokenFromQs,
          redirect: url,
          exp: expFromToken || undefined,
          token_id: tokenIdFromToken || undefined,
          flow: effectiveFlow,
          question_id: questionIdFromToken,
          mode: effectiveMode,
          question: questionText,
          options,
        },
        headers
      );
    }

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

    // ✅ Flow e mode devono seguire la domanda (evita mix Speaker/Listener)
    // NB: se la domanda non ha `flow` valido in DB, NON forziamo 'speaker' automaticamente.
    const dbFlow = normalizeFlowOptional(q.row.flow || "");
    const effectiveFlow = dbFlow ? dbFlow : flow;
    const effectiveMode = String(q.mode || "yn").trim().toLowerCase();

    // Scadenza token: 7 giorni (manteniamo ms per compatibilità con la logica lato vote)
    const exp = Date.now() + 7 * 24 * 60 * 60 * 1000;

    // Token id unico (serve per bloccare doppi voti sullo stesso link)
    const token_id = crypto.randomBytes(16).toString("hex");

    // JWT payload: email (e) + questionId (q) + expiry (exp) + token id (t) + flow (f) + mode (m)
    const headerB64 = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payloadB64 = base64url(
      JSON.stringify({ e: email, q: questionId, exp, t: token_id, f: effectiveFlow, m: effectiveMode })
    );

    const signingInput = `${headerB64}.${payloadB64}`;
    const sigB64 = signJwt(MICRO_POLL_SECRET, signingInput);
    const token = `${signingInput}.${sigB64}`;

    // URL completo della pagina voto (usato solo per redirect)
    const url = `${redirectBase}/micro?token=${encodeURIComponent(token)}`;

    const headers = corsHeaders(origin);

    // Se è una chiamata GET da email/click, reindirizziamo direttamente alla pagina voto.
    // Se invece vuoi il JSON (fetch dal frontend), ritorniamo JSON automaticamente.
    if (event.httpMethod === "GET" && !wantsJson) {
      return redirect(302, url, headers);
    }

    // Normalizzo payload per il client
    const questionText = String(q.row.question || "");
    const options =
      q.mode === "multi"
        ? Array.isArray(q.row.options)
          ? q.row.options
          : []
        : ["Sì", "No"];

    return json(
      200,
      {
        ok: true,
        token,
        exp,
        token_id,
        flow: effectiveFlow,
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