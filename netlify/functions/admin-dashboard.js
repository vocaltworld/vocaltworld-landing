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
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

exports.handler = async (event) => {
  try {
    // ✅ AUTH (UNICA)
    const ADMIN_KEY = String(process.env.ADMIN_KEY || process.env.ADMIN_DASHBOARD_KEY || "").trim();
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
      return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    // Leggiamo gli ultimi 1000 record (puoi cambiare limit)
    const endpoint =
      `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}` +
      `?select=id,email,score,interestScore,level,isInterested,consent,createdAt,surveyCompletedAt,answers` +
      `&order=createdAt.desc.nullslast&limit=1000`;

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
      return json(res.status, { ok: false, error: "Supabase error", status: res.status, data });
    }

    const rows = Array.isArray(data) ? data : [];

    // Normalizzazione “chirurgica” (score/interestScore)
    const surveys = rows.map((r) => {
      const normalizedScore =
        typeof r.score === "number"
          ? r.score
          : r.score != null
            ? Number(r.score)
            : (r.interestScore != null ? Number(r.interestScore) : null);

      const isInterested =
        typeof r.isInterested === "boolean"
          ? r.isInterested
          : (normalizedScore != null ? normalizedScore >= 6 : null);

      return {
        email: r.email || "-",
        createdAt: r.createdAt || null,
        surveyCompletedAt: r.surveyCompletedAt || r.createdAt || null,
        answers: r.answers || null,
        score: normalizedScore,
        interestScore: normalizedScore,
        isInterested,
        consent: !!r.consent,
        level: r.level ?? null,
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
    return json(500, { ok: false, error: "Internal error", message: err?.message || String(err) });
  }
};