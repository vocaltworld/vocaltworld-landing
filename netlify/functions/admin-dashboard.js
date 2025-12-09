// netlify/functions/admin-dashboard.js

exports.handler = async (event) => {
  try {
    // 1️⃣ Solo POST
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ ok: false, error: "Method not allowed" }),
      };
    }

    // 2️⃣ Leggo il body e il secret
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (err) {
      console.error("Errore parsing body admin:", err);
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "Bad request" }),
      };
    }

    const secretFromClient = body.secret || "";
    const adminKey = process.env.ADMIN_DASHBOARD_KEY;

    if (!adminKey) {
      console.error("ADMIN_DASHBOARD_KEY non configurata su Netlify");
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

    // 3️⃣ Leggo i profili da Klaviyo
    const apiKey = process.env.KLAVIYO_PRIVATE_KEY;

    if (!apiKey) {
      console.error("KLAVIYO_PRIVATE_KEY non configurata su Netlify");
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: "Missing Klaviyo private key",
        }),
      };
    }

    let surveys = [];
    let nextUrl =
      "https://a.klaviyo.com/api/profiles/?page[size]=100&sort=-created";

    // Limite di sicurezza per evitare loop infiniti
    const MAX_PAGES = 10;

    for (let page = 0; page < MAX_PAGES && nextUrl; page++) {
      const res = await fetch(nextUrl, {
        method: "GET",
        headers: {
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          Accept: "application/json",
          Revision: "2024-07-15",
        },
      });

      if (!res.ok) {
        const text = await res.text();
        console.error("Errore Klaviyo get profiles:", res.status, text);
        return {
          statusCode: 502,
          body: JSON.stringify({
            ok: false,
            error: "Klaviyo API error (profiles)",
            status: res.status,
            details: text,
          }),
        };
      }

      const data = await res.json().catch(() => ({}));
      const items = data.data || [];

      for (const p of items) {
        const attrs = p.attributes || {};
        const props = attrs.properties || {};

        // Usiamo solo i profili che hanno un survey_score
        if (props.survey_score != null) {
          const scoreNum = Number(props.survey_score);
          if (!Number.isNaN(scoreNum)) {
            const email = attrs.email || props.email || "";
            const completedAt =
              props.survey_completed_at || attrs.created || null;

            // Consideriamo "interessato" chi ha level non nullo
            // (Pioneer / Speaker / Listener) oppure score >= 5
            const level = props.survey_level || null;
            const interested = level != null || scoreNum >= 5;

            const createdAt =
              completedAt || attrs.created_at || attrs.created || null;

            // Normalizziamo i campi così che il frontend possa leggerli in modo coerente
            // Prima proviamo a leggere le risposte aggregate salvate da Klaviyo
            let answers = {};
            const answersRaw = props.survey_answers;

            if (answersRaw && typeof answersRaw === "string") {
              try {
                answers = JSON.parse(answersRaw);
              } catch (e) {
                console.error("Errore parsing survey_answers:", e, answersRaw);
              }
            }

            // Fallback / merge: se qualche campo manca, lo recuperiamo dai vecchi nomi di proprietà
            answers = {
              // Uso principale / contesto d'uso
              mainUse:
                answers.mainUse ||
                answers.main_use ||
                props.q1_main_use ||
                props.main_use ||
                props.uso_principale ||
                null,

              // Frequenza con cui ha bisogno di tradurre
              frequency:
                answers.frequency ||
                props.q2_frequency ||
                props.frequency ||
                props.quanto_spesso_traduci ||
                null,

              // Quanto gli interesserebbe un traduttore vocale offline
              interestOfflineDevice:
                answers.offlineInterest ||
                answers.interestOfflineDevice ||
                props.q3_interest_offline_device ||
                props.interesse_traduttore_offline ||
                null,

              // Fascia di prezzo considerata ok
              priceRange:
                answers.priceRange ||
                props.q4_price_range ||
                props.fascia_prezzo ||
                null,

              // Soluzione che usa oggi per tradurre
              currentSolution:
                answers.currentSolution ||
                props.q5_current_solution ||
                props.soluzione_attuale ||
                null,

              // Difficoltà a comunicare in lingua straniera
              difficulty:
                answers.communicationDifficulty ||
                answers.difficulty ||
                props.q6_difficulty_foreign_language ||
                props.difficolta_lingua ||
                null,

              // Interesse immediato per un traduttore offline come Vocal T World
              immediateInterest:
                answers.instantOfflineInterest ||
                answers.immediateInterest ||
                props.q7_immediate_interest ||
                props.interesse_immediato ||
                null,

              // Profilo calcolato (es. "Interessato", "Pioneer", ecc.)
              profileLabel:
                answers.profileLabel ||
                props.survey_profile_label ||
                props.survey_level ||
                null,
            };

            surveys.push({
              email,
              date: createdAt,
              createdAt,
              submittedAt: createdAt,
              score: scoreNum,
              interested,
              answers,
              // Manteniamo anche tutte le properties originali per eventuale debug futuro
              rawProperties: props,
            });
          }
        }
      }

      // Paginazione
      nextUrl = data.links && data.links.next ? data.links.next : null;
    }

    // Ordiniamo i risultati per data (più recenti in alto)
    surveys.sort((a, b) => {
      if (!a.date && !b.date) return 0;
      if (!a.date) return 1;
      if (!b.date) return -1;
      const da = new Date(a.date);
      const db = new Date(b.date);
      if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return 0;
      return db - da;
    });

    // 4️⃣ Calcolo statistiche
    const total = surveys.length;
    const interestedCount = surveys.filter((s) => s.interested).length;
    const notInterestedCount = total - interestedCount;

    const interestedPercent =
      total > 0 ? Math.round((interestedCount / total) * 100) : 0;
    const notInterestedPercent = total > 0 ? 100 - interestedPercent : 0;

    const stats = {
      total,
      interested: interestedCount,
      notInterested: notInterestedCount,
      interestedPercent,
      notInterestedPercent,
    };

    // 5️⃣ Risposta nel formato atteso dalla dashboard
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        surveys,
        stats,
      }),
    };
  } catch (err) {
    console.error("Errore generale admin-dashboard:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ ok: false, error: "Internal Server Error" }),
    };
  }
};