// netlify/functions/admin-micro-polls.js
// Admin API for micro-polls (questions list + results by question_id)
// IMPORTANT: keeps existing behavior but adds:
// - POST support (recommended)
// - admin key auth (same pattern as admin-dashboard)
// - CORS + OPTIONS handling

exports.handler = async function handler(event) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Reuse the same admin secret used by the dashboard (try multiple env names to be resilient)
  const ADMIN_SECRET =
    process.env.VT_ADMIN_KEY ||
    process.env.ADMIN_DASHBOARD_KEY ||
    process.env.ADMIN_KEY ||
    process.env.ADMIN_SECRET ||
    "";

  const origin = event.headers?.origin || event.headers?.Origin || "";

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return json(200, { ok: true }, origin);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { ok: false, error: "Missing env" }, origin);
  }

  // Auth: require x-admin-key to match ADMIN_SECRET
  // (same header name you already use from the client for admin-dashboard)
  const reqAdminKey =
    (event.headers?.["x-admin-key"] || event.headers?.["X-Admin-Key"] || "").toString().trim();

  if (!ADMIN_SECRET) {
    // Safer default: do NOT expose data if secret isn't configured
    return json(500, { ok: false, error: "Missing admin secret env" }, origin);
  }

  if (!reqAdminKey || reqAdminKey !== ADMIN_SECRET) {
    return json(401, { ok: false, error: "unauthorized" }, origin);
  }

  // Support both GET (query params) and POST (JSON body)
  const qs = event.queryStringParameters || {};
  const body = safeJson(event.body);

  const mode = String(body?.mode ?? qs?.mode ?? "")
    .toLowerCase()
    .trim();
  const questionId = String(body?.question_id ?? body?.questionId ?? qs?.question_id ?? "")
    .trim();

  try {
    if (mode === "questions") {
      const { data, error } = await sbGet(
        `${SUPABASE_URL}/rest/v1/micro_questions?select=id,question,option_yes,option_no,active,campaign_key,campaign_label&order=created_at.desc`,
        SERVICE_KEY
      );
      if (error) throw error;

      // normalize a bit for UI convenience (without breaking existing fields)
      const questions = Array.isArray(data)
        ? data.map((q) => ({
            ...q,
            // stable label fallback
            label: q?.campaign_label || q?.campaign_key || q?.question || q?.id,
          }))
        : [];

      return json(200, { ok: true, questions }, origin);
    }

    if (mode === "results") {
      if (!questionId) return json(400, { ok: false, error: "missing_question_id" }, origin);

      const { data: rows, error: rErr } = await sbGet(
        `${SUPABASE_URL}/rest/v1/micro_poll_responses?select=created_at,choice,email,voter_hash,question_id&question_id=eq.${encodeURIComponent(
          questionId
        )}&order=created_at.desc&limit=500`,
        SERVICE_KEY
      );
      if (rErr) throw rErr;

      const safeRows = Array.isArray(rows) ? rows : [];

      const yes = safeRows.filter((r) => String(r.choice) === "1").length;
      const no = safeRows.filter((r) => String(r.choice) === "2").length;
      const total = yes + no;

      const pctYes = total ? Math.round((yes / total) * 100) : 0;
      const pctNo = total ? Math.round((no / total) * 100) : 0;

      return json(
        200,
        {
          ok: true,
          question_id: questionId,
          rows: safeRows,
          stats: { yes, no, total, pctYes, pctNo },
        },
        origin
      );
    }

    return json(400, { ok: false, error: "invalid_mode" }, origin);
  } catch (e) {
    return json(500, { ok: false, error: "internal", message: String(e?.message || e) }, origin);
  }
}

function safeJson(body) {
  if (!body) return null;
  try {
    return typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return null;
  }
}

function json(statusCode, body, origin = "") {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      // Keep permissive CORS for now, but echo origin if present
      "Access-Control-Allow-Origin": origin || "*",
      "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

async function sbGet(url, serviceKey) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { data: null, error: { status: res.status, data } };
  }
  return { data, error: null };
}