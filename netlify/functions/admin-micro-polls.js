exports.handler = async function handler(event) {
  const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
  const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  // Reuse the same admin secret used by the dashboard (try multiple env names to be resilient)
  const ADMIN_SECRET = String(
    process.env.VT_ADMIN_KEY ||
      process.env.ADMIN_DASHBOARD_KEY ||
      process.env.ADMIN_KEY ||
      process.env.ADMIN_SECRET ||
      ""
  ).trim();

  const origin = event?.headers?.origin || event?.headers?.Origin || "";

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    // 204 = no content (clean preflight)
    return json(204, undefined, origin);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { ok: false, error: "missing_env" }, origin);
  }

  // Auth: require x-admin-key to match ADMIN_SECRET
  // (same header name you already use from the client for admin-dashboard)
  const reqAdminKey = String(
    event?.headers?.["x-admin-key"] || event?.headers?.["X-Admin-Key"] || ""
  ).trim();

  if (!ADMIN_SECRET) {
    // Safer default: do NOT expose data if secret isn't configured
    return json(500, { ok: false, error: "missing_admin_secret" }, origin);
  }

  if (!reqAdminKey || reqAdminKey !== ADMIN_SECRET) {
    return json(401, { ok: false, error: "unauthorized" }, origin);
  }

  // Support both GET (query params) and POST (JSON body)
  const qs = event.queryStringParameters || {};
  const body = event.httpMethod === "POST" ? safeJson(event.body) : null;

  const mode = String(body?.mode ?? qs?.mode ?? "")
    .toLowerCase()
    .trim();

  const questionId = String(
    body?.question_id ?? body?.questionId ?? qs?.question_id ?? qs?.questionId ?? ""
  ).trim();

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
        `${SUPABASE_URL}/rest/v1/micro_poll_responses?select=created_at,choice,email,token_id,question_id&question_id=eq.${encodeURIComponent(
          questionId
        )}&order=created_at.desc&limit=500`,
        SERVICE_KEY
      );
      if (rErr) throw rErr;

      const safeRows = Array.isArray(rows) ? rows : [];

      // Accept both numeric and string forms just in case
      const yes = safeRows.filter((r) => {
        const c = String(r?.choice ?? "").toLowerCase();
        return c === "1" || c === "yes";
      }).length;
      const no = safeRows.filter((r) => {
        const c = String(r?.choice ?? "").toLowerCase();
        return c === "2" || c === "no";
      }).length;
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
    return json(500, { ok: false, error: "internal", message: e?.message || "unknown", detail: e }, origin);
  }
};

function safeJson(body) {
  if (!body) return null;
  try {
    return typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return null;
  }
}

function json(statusCode, body, origin = "") {
  // Keep permissive CORS for now, but echo origin if present
  const allowOrigin = origin || "*";

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  // For 204 we must not send a body
  if (statusCode === 204) {
    return { statusCode, headers, body: "" };
  }

  return {
    statusCode,
    headers,
    body: body === undefined ? "" : JSON.stringify(body),
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