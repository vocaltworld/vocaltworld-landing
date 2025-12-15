
// admin-dashboard.js
// Fonte primaria: Supabase (tutte le compilazioni del sondaggio)
// Fonte secondaria (opzionale, non bloccante): Klaviyo (in futuro per aggiornare email_subscribed)

const KLAVIYO_REVISION = "2024-02-15";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabaseEndpoint = (path) => {
  if (!SUPABASE_URL) return null;
  return `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`;
};

const supabaseHeaders = () => {
  if (!SUPABASE_SERVICE_ROLE_KEY) return null;
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  };
};

const supabaseFetchJson = async (url, init) => {
  const res = await fetch(url, init);
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { res, json };
};

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
      return json(401, { error: "Unauthorized" });
    }

    // ✅ ENV SUPABASE (PRIMARIO)
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      });
    }

    // Leggiamo TUTTE le submissions dal DB (anche chi NON ha confermato l'email)
    // Proviamo prima una select ricca, poi fallback minimale se alcune colonne non esistono.
    const selectRich =
      "email,created_at,survey_completed_at,score,interest_score,is_interested,email_subscribed,answers,level,consent";
    const selectMin =
      "email,created_at,survey_completed_at,score,interest_score,is_interested,email_subscribed";

    const buildUrl = (select) => {
      const base = supabaseEndpoint(
        `survey_submissions?select=${encodeURIComponent(select)}&order=created_at.desc&limit=1000`
      );
      return base;
    };

    let sbRes;
    let sbJson;

    // 1) rich
    {
      const { res, json: data } = await supabaseFetchJson(buildUrl(selectRich), {
        method: "GET",
        headers: supabaseHeaders(),
      });
      sbRes = res;
      sbJson = data;

      if (!sbRes.ok) {
        const msg = typeof sbJson === "object" && sbJson
          ? JSON.stringify(sbJson)
          : String(sbJson || "");
        const maybeMissingColumn = msg.includes("column") && msg.includes("does not exist");

        if (maybeMissingColumn) {
          console.warn(
            "Supabase select rich fallita per colonne mancanti. Faccio fallback minimal.",
            sbRes.status,
            sbJson
          );
          const { res: res2, json: data2 } = await supabaseFetchJson(buildUrl(selectMin), {
            method: "GET",
            headers: supabaseHeaders(),
          });
          sbRes = res2;
          sbJson = data2;
        }
      }
    }

    if (!sbRes.ok) {
      return json(sbRes.status, { error: "Supabase error", status: sbRes.status, data: sbJson });
    }

    const rows = Array.isArray(sbJson) ? sbJson : [];

    // Normalizza in surveys nel formato atteso dal frontend
    const surveys = rows.map((r) => {
      const email = r?.email || "-";
      const createdAt = r?.created_at || r?.survey_completed_at || null;
      const surveyCompletedAt = r?.survey_completed_at || createdAt;

      const answers = (r?.answers && typeof r.answers === "object") ? r.answers : {};

      const rawScore =
        (typeof r?.interest_score === "number" ? r.interest_score : null) ??
        (typeof r?.score === "number" ? r.score : null);

      const normalizedScore =
        typeof rawScore === "number" ? rawScore : (rawScore != null ? Number(rawScore) : null);

      const isInterested =
        typeof r?.is_interested === "boolean"
          ? r.is_interested
          : (normalizedScore != null ? normalizedScore >= 6 : null);

      const isEmailSubscribed =
        typeof r?.email_subscribed === "boolean" ? r.email_subscribed : null;

      return {
        email,
        createdAt,
        surveyCompletedAt,
        answers,
        // compat con UI
        score: normalizedScore,
        interestScore: normalizedScore,
        isInterested,
        isEmailSubscribed,
        // extra (se presenti)
        level: r?.level ?? answers?.survey_level ?? null,
        consent: typeof r?.consent === "boolean" ? r.consent : undefined,
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

    return json(200, { stats, surveys });
  } catch (err) {
    return json(500, { error: "Internal error", message: err?.message || String(err) });
  }
};