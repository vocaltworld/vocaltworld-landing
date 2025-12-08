exports.handler = async (event) => {
  // Consenti solo richieste POST dalla dashboard
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  let secretFromClient = "";

  try {
    const body = JSON.parse(event.body || "{}");
    // Proviamo prima a leggere il segreto dal body (per le richieste POST)
    secretFromClient = body.secret || "";
  } catch (err) {
    console.error("Errore parsing body:", err);
    // non usciamo subito: proveremo a leggere l'header più sotto
  }

  // Se dal body non è arrivato nulla, proviamo a leggerlo dagli header
  if (!secretFromClient) {
    const headers = event.headers || {};
    secretFromClient =
      headers["x-admin-secret"] ||
      headers["X-Admin-Secret"] ||
      headers["x-admin-secret".toLowerCase()] ||
      "";
  }

  // Normalizzo il segreto arrivato dal client (evito spazi / newline)
  secretFromClient = String(secretFromClient || "").trim();

  let adminKey = process.env.ADMIN_DASHBOARD_KEY;
  // Normalizzo anche la chiave lato server
  adminKey = String(adminKey || "").trim();

  // Debug soft: verifico solo che la env esista (NON stampo il valore)
  if (!adminKey) {
    console.error("ADMIN_DASHBOARD_KEY non è impostata su Netlify!");
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "Server misconfigured (missing admin key)",
      }),
    };
  }

  // Confronto 1:1 tra quello che digiti e la env su Netlify
  if (secretFromClient === adminKey) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  }

  // Codice errato
  return {
    statusCode: 401,
    body: JSON.stringify({ ok: false, error: "Invalid secret" }),
  };
};