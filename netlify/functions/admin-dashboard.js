// netlify/functions/admin-dashboard.js
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

exports.handler = async (event) => {
  // permetti solo POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  let secretFromClient = "";
  try {
    const body = JSON.parse(event.body || "{}");
    secretFromClient = body.secret || "";
  } catch (err) {
    console.error("Errore parsing body:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: "Bad request" }),
    };
  }

  const adminKey = process.env.ADMIN_DASHBOARD_KEY;
  if (!adminKey) {
    console.error("ADMIN_DASHBOARD_KEY non impostata su Netlify");
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "Server misconfigured (missing admin key)",
      }),
    };
  }

  if (secretFromClient !== adminKey) {
    return {
      statusCode: 401,
      body: JSON.stringify({ ok: false, error: "Invalid secret" }),
    };
  }

  // 🔑 Klaviyo
  const klaviyoKey = process.env.KLAVIYO_PRIVATE_KEY;
  const listId = process.env.KLAVIYO_LIST_ID;

  if (!klaviyoKey || !listId) {
    console.error("KLAVIYO_PRIVATE_KEY o KLAVIYO_LIST_ID mancanti");
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "Server misconfigured (missing Klaviyo env vars)",
      }),
    };
  }

  try {
    // 🔎 prendiamo TUTTI i membri della lista da Klaviyo (API v2)
    const url = `https://a.klaviyo.com/api/v2/list/${listId}/members/all?api_key=${klaviyoKey}`;
    const res = await fetch(url);
    if (!res.ok) {
      const text = await res.text();
      console.error("Errore Klaviyo:", res.status, text);
      throw new Error("Errore nel recupero dati da Klaviyo");
    }

    const payload = await res.json();
    const records = payload.records || [];
    console.log("Klaviyo payload records count:", records.length);

    const completedRecords = records.filter(
      (r) => r.properties && r.properties.survey_completed
    );

    console.log(
      "Klaviyo completed survey records count:",
      completedRecords.length
    );

    // 🎯 trasformiamo i profili Klaviyo in "surveys" per la dashboard
    const surveys = completedRecords.map((r) => {
      const props = r.properties || {};

      // survey_answers può essere stringa JSON o oggetto
      let answers = {};
      if (props.survey_answers) {
        if (typeof props.survey_answers === "string") {
          try {
            answers = JSON.parse(props.survey_answers);
          } catch (e) {
            console.warn(
              "Impossibile fare JSON.parse di survey_answers:",
              e
            );
          }
        } else if (typeof props.survey_answers === "object") {
          answers = props.survey_answers;
        }
      }

      const score = props.survey_score ?? null;
      const level = props.survey_level || "";
      const interested =
        level.toLowerCase() === "speaker" ||
        level.toLowerCase() === "interessato" ||
        level.toLowerCase() === "molto interessato";

      return {
        email: r.email,
        createdAt: props.survey_completed_at || props.$last_event_time || null,
        score,
        level,
        interested,
        answers: {
          usageFrequency: answers.usageFrequency || answers.usage_frequency,
          mainUseCase: answers.mainUseCase || answers.main_use_case,
          offlineInterest:
            answers.offlineInterest || answers.offline_interest,
          priceRange: answers.priceRange || answers.price_range,
          communicationDifficulty:
            answers.communicationDifficulty ||
            answers.communication_difficulty,
          currentSolution:
            answers.currentSolution || answers.current_solution,
          instantOfflineInterest:
            answers.instantOfflineInterest ||
            answers.instant_offline_interest,
          extraNote: answers.extraNote || answers.extra_note,
        },
      };
    });

    // 📊 calcoliamo le stats
    const total = surveys.length;
    const interestedCount = surveys.filter((s) => s.interested).length;
    const notInterestedCount = total - interestedCount;

    const interestedPercent = total
      ? Math.round((interestedCount / total) * 100)
      : 0;
    const notInterestedPercent = total
      ? Math.round((notInterestedCount / total) * 100)
      : 0;

    const stats = {
      total,
      interested: interestedCount,
      notInterested: notInterestedCount,
      interestedPercent,
      notInterestedPercent,
    };

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        stats,
        surveys,
      }),
    };
  } catch (err) {
    console.error("Errore generico admin-dashboard:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "Internal Server Error",
      }),
    };
  }
};