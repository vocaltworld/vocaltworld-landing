// netlify/functions/admin-dashboard.js

const SUPABASE_TABLE = "survey_submissions";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getHeader(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  );
  return key ? String(headers[key] || "") : "";
}

function safeNumber(v) {
  if (typeof v === "number") return v;
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

exports.handler = async (event) => {
  try {
    // ✅ AUTH (UNICA)
    const ADMIN_KEY = String(
      process.env.ADMIN_KEY || process.env.ADMIN_DASHBOARD_KEY || ""
    ).trim();

    const headerKey = getHeader(event.headers, "x-admin-key").trim();

    let bodyKey = "";
    try {
      const parsed = event.body ? JSON.parse(event.body) : {};
      bodyKey = String(parsed?.secret || "").trim();
    } catch {}

    const provided = headerKey || bodyKey;

    if (!ADMIN_KEY || provided !== ADMIN_KEY) {
      return json(401, { ok: false, error: "Unauthorized" });
    }

    // ✅ ENV SUPABASE
    const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
    const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, {
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    // ✅ Query param opzionale: limit
    const limit = Math.min(
      Math.max(parseInt(event.queryStringParameters?.limit || "1000", 10) || 1000, 1),
      5000
    );

    // Normalizziamo URL (niente doppio //)
    const base = SUPABASE_URL.replace(/\/$/, "");

    // ✅ Colonne REALI in tabella (snake_case)
    // NOTA: non selezioniamo campi che NON esistono (es. interestScore/createdAt camelCase)
    const select = [
      "id",
      "email",
      "created_at",
      "survey_completed",
      "survey_completed_at",
      "email_subscribed",
      "email_subscribed_at",
      "score",
      "interest_score",
      "is_interested",
      "answers",
      "source",
    ].join(",");

    const endpoint =
      `${base}/rest/v1/${encodeURIComponent(SUPABASE_TABLE)}` +
      `?select=${encodeURIComponent(select)}` +
      `&order=created_at.desc.nullslast` +
      `&limit=${limit}`;

    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      return json(res.status, {
        ok: false,
        error: "Supabase error",
        status: res.status,
        data,
      });
    }

    const rows = Array.isArray(data) ? data : [];

    // ✅ Normalizzazione verso lo shape che usa la dashboard (camelCase + campi coerenti)
    const surveys = rows.map((r) => {
      const normalizedScore = safeNumber(r?.score ?? r?.interest_score);

      const normalizedIsInterested =
        typeof r?.is_interested === "boolean"
          ? r.is_interested
          : normalizedScore != null
            ? normalizedScore >= 6
            : null;

      const isEmailSubscribed =
        typeof r?.email_subscribed === "boolean" ? r.email_subscribed : false;

      return {
        email: r?.email || "-",
        createdAt: r?.created_at || null,
        surveyCompletedAt: r?.survey_completed_at || r?.created_at || null,
        answers: r?.answers ?? null,
        score: normalizedScore,
        interestScore: normalizedScore,
        isInterested: normalizedIsInterested,
        isEmailSubscribed,
        // campi extra utili
        surveyCompleted:
          typeof r?.survey_completed === "boolean" ? r.survey_completed : null,
        emailSubscribedAt: r?.email_subscribed_at || null,
        source: r?.source ?? null,
      };
    });

    const total = surveys.length;
    const interestedCount = surveys.filter((s) => s.isInterested === true).length;
    const notInterestedCount = total - interestedCount;

    const stats = {
      total,
      interested: interestedCount,
      notInterested: notInterestedCount,
      interestedPercent: total ? Math.round((interestedCount / total) * 100) : 0,
      notInterestedPercent: total
        ? Math.round((notInterestedCount / total) * 100)
        : 0,
    };

    return json(200, { ok: true, stats, surveys });
  } catch (err) {
    return json(500, {
      ok: false,
      error: "Internal error",
      message: err?.message || String(err),
    });
  }
};