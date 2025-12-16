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

    const urlBase = SUPABASE_URL.replace(/\/$/, "");

    // query params
    const qs = event.queryStringParameters || {};
    const limit = Math.min(Number(qs.limit || 1000) || 1000, 5000);

    // ✅ LEGGIAMO SOLO COLONNE REALI (snake_case)
    const select =
      [
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
      `${urlBase}/rest/v1/${SUPABASE_TABLE}` +
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

    const data = await res.json().catch(() => null);

    if (!res.ok) {
      return json(res.status, {
        ok: false,
        error: "Supabase error",
        status: res.status,
        data,
      });
    }

    const rows = Array.isArray(data) ? data : [];

    // ✅ Normalizzazione → output in camelCase per il frontend
    const surveys = rows.map((r) => {
      const numericScore =
        r.score != null ? Number(r.score) :
        r.interest_score != null ? Number(r.interest_score) :
        null;

      const isInterested =
        typeof r.is_interested === "boolean"
          ? r.is_interested
          : (numericScore != null ? numericScore >= 6 : null);

      return {
        email: r.email || "-",
        createdAt: r.created_at || null,
        surveyCompleted: !!r.survey_completed,
        surveyCompletedAt: r.survey_completed_at || r.created_at || null,

        // 🔥 questo è quello che ti serve per togliere "Solo sondaggio"
        isEmailSubscribed: !!r.email_subscribed,
        emailSubscribedAt: r.email_subscribed_at || null,

        score: numericScore,
        interestScore: numericScore,
        isInterested,

        answers: r.answers || null,
        source: r.source ?? null,
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
      notInterestedPercent: total ? Math.round((notInterestedCount / total) * 100) : 0,
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