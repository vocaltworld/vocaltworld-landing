const crypto = require("crypto");

const SUPABASE_TABLE = "micro_poll_responses";

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  };
}

function safeEqual(a, b) {
  const sa = String(a);
  const sb = String(b);
  // If lengths differ, timingSafeEqual would throw.
  if (sa.length !== sb.length) return false;
  return crypto.timingSafeEqual(Buffer.from(sa), Buffer.from(sb));
}

function sign(secret, payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

function base64urlToString(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 ? "=".repeat(4 - (b64.length % 4)) : "";
  return Buffer.from(b64 + pad, "base64").toString("utf8");
}

exports.handler = async (event) => {
  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") return json(204, {});

    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    const MICRO_POLL_SECRET = String(process.env.MICRO_POLL_SECRET || "").trim();
    const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
    const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!MICRO_POLL_SECRET) return json(500, { ok: false, error: "Missing MICRO_POLL_SECRET" });
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    let payload = {};
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch {
      payload = {};
    }

    const token = String(payload.token || payload.token_id || "").trim();

    // UI may send: "1"/"2" or "yes"/"no".
    const rawChoice = String(payload.choice || "").trim().toLowerCase();
    let choice = rawChoice;
    if (rawChoice === "yes") choice = "1";
    if (rawChoice === "no") choice = "2";

    if (!token) return json(400, { ok: false, error: "missing_token" });
    if (choice !== "1" && choice !== "2") return json(400, { ok: false, error: "invalid_choice" });

    const [data, sig] = token.split(".");
    if (!data || !sig) return json(400, { ok: false, error: "Invalid token format" });

    const expectedSig = sign(MICRO_POLL_SECRET, data);
    if (!safeEqual(sig, expectedSig)) return json(401, { ok: false, error: "invalid_token" });

    let decoded;
    try {
      decoded = JSON.parse(base64urlToString(data));
    } catch {
      return json(400, { ok: false, error: "invalid_token" });
    }

    const email = String(decoded?.e || "").trim().toLowerCase();
    const question_id = String(decoded?.q || "").trim();
    const exp = Number(decoded?.exp || 0);

    if (!email || !question_id || !exp) return json(400, { ok: false, error: "token_missing_fields" });
    if (Date.now() > exp) return json(401, { ok: false, error: "token_expired" });

    // Optional: if client sends question_id, it MUST match the token (anti-tampering)
    const clientQ = String(payload.question_id || payload.questionId || "").trim();
    if (clientQ && clientQ !== question_id) {
      return json(400, { ok: false, error: "question_mismatch" });
    }

    // Hash (privacy + chiave unica)
    const voter_hash = crypto.createHash("sha256").update(email).digest("hex");

    const endpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}`;

    const insertRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify({ question_id, choice, voter_hash, email }),
    });

    const insertData = await insertRes.json().catch(() => null);

    if (!insertRes.ok) {
      // se hai creato l'unique index, il doppio voto torna 409
      if (insertRes.status === 409) {
        return json(200, { ok: true, already_voted: true });
      }
      return json(insertRes.status, {
        ok: false,
        error: "Supabase error",
        status: insertRes.status,
        data: insertData,
      });
    }

    return json(200, { ok: true, saved: true, question_id, choice });
  } catch (err) {
    return json(500, { ok: false, error: "Internal error", message: err?.message || String(err) });
  }
};