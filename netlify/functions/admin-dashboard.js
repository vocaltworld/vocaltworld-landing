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
            // - `date`: usato attualmente dalla dashboard
            // - `createdAt` / `submittedAt`: alias utili se in futuro cambiamo i nomi nel frontend
            surveys.push({
              email,
              date: createdAt,
              createdAt,
              submittedAt: createdAt,
              score: scoreNum,
              interested,
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