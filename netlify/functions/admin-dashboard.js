// netlify/functions/admin-dashboard.js

exports.handler = async (event) => {
  // Permettiamo solo POST dalla dashboard
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  // 🔐 Lettura e normalizzazione del codice segreto dal body
  let secretFromClient = "";

  try {
    const body = JSON.parse(event.body || "{}");
    const { secret, adminSecret, password, code } = body;

    // Accettiamo diversi possibili nomi di campo
    secretFromClient = secret || adminSecret || password || code || "";
  } catch (err) {
    console.error("Errore parsing body admin-dashboard:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: "Bad request" }),
    };
  }

  const normalize = (s) => (s || "").toString().trim();

  const clientSecret = normalize(secretFromClient);
  let serverSecret = normalize(process.env.ADMIN_DASHBOARD_KEY || "");

  if (!serverSecret) {
    console.error("ADMIN_DASHBOARD_KEY mancante nell'ambiente Netlify!");
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "Server misconfigured (missing admin key)",
      }),
    };
  }

  if (clientSecret !== serverSecret) {
    return {
      statusCode: 401,
      body: JSON.stringify({
        ok: false,
        error: "Invalid secret",
      }),
    };
  }

  // 🔑 A questo punto il codice segreto è valido → leggiamo i dati da Klaviyo
  try {
    const apiKey = process.env.KLAVIYO_PRIVATE_KEY;

    if (!apiKey) {
      console.error(
        "KLAVIYO_PRIVATE_KEY mancante nell'ambiente Netlify (admin-dashboard)"
      );
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: "Missing Klaviyo private key",
        }),
      };
    }

    // Recupero tutti i profili che hanno completato il sondaggio
    let surveys = [];
    let url =
      'https://a.klaviyo.com/api/profiles/?filter=equals(properties.survey_completed,true)&page[size]=100';

    // Ciclo di paginazione base (max 5 pagine per sicurezza)
    for (let i = 0; i < 5 && url; i++) {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          Accept: "application/json",
          Revision: "2024-07-15",
        },
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("Errore Klaviyo admin-dashboard:", res.status, data);
        return {
          statusCode: 502,
          body: JSON.stringify({
            ok: false,
            error: "Klaviyo API error (admin-dashboard)",
            status: res.status,
          }),
        };
      }

      const items = Array.isArray(data.data) ? data.data : [];

      // Mappo i profili nel formato atteso dalla dashboard
      for (const item of items) {
        const attrs = item.attributes || {};
        const props = attrs.properties || {};

        const email = attrs.email || "";
        const score = Number(props.survey_score ?? 0) || 0;
        const level = props.survey_level || null;
        const surveyCompletedAt = props.survey_completed_at || null;

        const consent =
          !!attrs.subscriptions &&
          !!attrs.subscriptions.email &&
          !!attrs.subscriptions.email.marketing &&
          attrs.subscriptions.email.marketing.consent === "SUBSCRIBED";

        const isInterested = score >= 5; // stessa logica alleggerita che usiamo nel resto

        surveys.push({
          email,
          score,
          level,
          consent,
          isInterested,
          surveyCompletedAt,
        });
      }

      // Gestione paginazione Klaviyo (link "next")
      const links = data.links || {};
      url = links.next || null;
    }

    // 📊 Calcolo statistiche aggregate
    const total = surveys.length;
    const interestedCount = surveys.filter((s) => s.isInterested).length;
    const notInterestedCount = total - interestedCount;
    const interestedPercent = total
      ? Math.round((interestedCount / total) * 100)
      : 0;
    const notInterestedPercent = 100 - interestedPercent;

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
        surveys,
        stats,
      }),
    };
  } catch (err) {
    console.error("Errore generale admin-dashboard Klaviyo:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "Dashboard read error",
      }),
    };
  }
};