// netlify/functions/admin-dashboard.js
// Function server-side che legge i dati dal server locale (API Vocal T World)
// e li espone alla dashboard React, con protezione tramite chiave admin.

exports.handler = async (event, context) => {
  try {
    // 🔐 Controllo chiave admin inviata dal client
    const adminKey = process.env.ADMIN_DASHBOARD_KEY;
    const providedKey =
      event.headers["x-admin-key"] || event.headers["X-Admin-Key"];

    console.log("ADMIN_DASHBOARD_KEY (env):", adminKey);
    console.log("ADMIN_DASHBOARD_KEY (provided):", providedKey);

    if (!adminKey || !providedKey || providedKey !== adminKey) {
      return {
        statusCode: 401,
        body: JSON.stringify({ error: "unauthorized" }),
      };
    }

    // Base URL del server API (in locale è http://localhost:4000)
    const baseUrl =
      process.env.DASHBOARD_API_BASE_URL || "http://localhost:4000";

    // Chiedo sia l'elenco sondaggi che le statistiche aggregate
    const [surveysRes, statsRes] = await Promise.all([
      fetch(`${baseUrl}/api/surveys`),
      fetch(`${baseUrl}/api/stats`),
    ]);

    const surveysJson = await surveysRes.json().catch(() => ({}));
    const statsJson = await statsRes.json().catch(() => ({}));

    console.log("admin-dashboard: surveys status", surveysRes.status);
    console.log("admin-dashboard: stats status", statsRes.status);

    if (!surveysRes.ok || !statsRes.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "dashboard_api_error",
          surveysStatus: surveysRes.status,
          statsStatus: statsRes.status,
          surveysBody: surveysJson,
          statsBody: statsJson,
        }),
      };
    }

    // La nostra API server restituisce { surveys: [...] }
    const surveys = Array.isArray(surveysJson.surveys)
      ? surveysJson.surveys
      : [];

    // Se statsJson è valido lo usiamo, altrimenti costruiamo qualcosa di base
    const stats =
      statsJson && typeof statsJson === "object"
        ? statsJson
        : {
            total: surveys.length,
            interested: surveys.filter((s) => s.isInterested).length,
            notInterested: surveys.filter((s) => !s.isInterested).length,
          };

    return {
      statusCode: 200,
      body: JSON.stringify({
        stats,
        surveys,
      }),
    };
  } catch (err) {
    console.error("Errore generale in admin-dashboard:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        message: err.message,
      }),
    };
  }
};