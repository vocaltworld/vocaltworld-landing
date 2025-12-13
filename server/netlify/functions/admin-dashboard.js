const KLAVIYO_REVISION = "2024-02-15";

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

    // ✅ ENV KLAVIYO
    const KLAVIYO_PRIVATE_KEY = String(process.env.KLAVIYO_PRIVATE_KEY || "").trim();
    const KLAVIYO_LIST_ID = String(process.env.KLAVIYO_LIST_ID || "").trim();

    if (!KLAVIYO_PRIVATE_KEY || !KLAVIYO_LIST_ID) {
      return json(500, { error: "Missing KLAVIYO_PRIVATE_KEY or KLAVIYO_LIST_ID" });
    }

    // ✅ Fetch members of list (Klaviyo v2024)
    const url = `https://a.klaviyo.com/api/lists/${encodeURIComponent(
      KLAVIYO_LIST_ID
    )}/profiles/?page[size]=100`;

    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Klaviyo-API-Key ${KLAVIYO_PRIVATE_KEY}`,
        Accept: "application/json",
        revision: KLAVIYO_REVISION,
      },
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }

    if (!res.ok) {
      return json(res.status, { error: "Klaviyo error", status: res.status, data });
    }

    const profiles = Array.isArray(data?.data) ? data.data : [];

    // Normalizza in surveys
    const surveys = profiles.map((p) => {
      const attrs = p?.attributes || {};
      const props = attrs?.properties || {};
      const email = attrs?.email || "-";
      const createdAt = attrs?.updated || attrs?.created || null;

      // answers = proprietà custom (dove Klaviyo salva survey_* ecc.)
      const answers = props || {};

      // --- NORMALIZZAZIONE SCORE / INTERESSE (chirurgica) ---
      const rawSurveyScore =
        answers?.survey_score ??
        answers?.surveyScore ??
        answers?.interestScore ??
        answers?.score ??
        null;

      const normalizedScore =
        typeof rawSurveyScore === "number"
          ? rawSurveyScore
          : rawSurveyScore != null
            ? Number(rawSurveyScore)
            : null;

      const normalizedIsInterested =
        normalizedScore != null ? normalizedScore >= 6 : null;

      // stato iscrizione: se c'è consenso email confermato
      const consentArr = Array.isArray(answers?.$consent) ? answers.$consent : [];
      const isEmailSubscribed = consentArr.includes("email");

      return {
        email,
        createdAt,
        surveyCompletedAt: createdAt,
        answers,
        // campi normalizzati (evita null e mismatch)
        score: normalizedScore,
        interestScore: normalizedScore,
        isInterested: normalizedIsInterested,
        isEmailSubscribed,
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