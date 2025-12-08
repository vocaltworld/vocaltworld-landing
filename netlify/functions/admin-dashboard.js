exports.handler = async (event) => {
  let secretFromClient = "";

  // 1. Recupero il segreto in base al metodo HTTP
  if (event.httpMethod === "POST") {
    // Richiesta dal form (login)
    try {
      const body = JSON.parse(event.body || "{}");
      secretFromClient = body.secret || "";
    } catch (err) {
      console.error("Errore parsing body POST:", err);
      return {
        statusCode: 400,
        body: JSON.stringify({ ok: false, error: "Bad request" }),
      };
    }
  } else if (event.httpMethod === "GET") {
    // Richieste di caricamento dati che passano il segreto come query o header
    const qs = event.queryStringParameters || {};
    secretFromClient = qs.secret || "";

    // Se non arriva in query, provo dagli header
    if (!secretFromClient) {
      const headers = event.headers || {};
      secretFromClient =
        headers["x-admin-secret"] ||
        headers["X-Admin-Secret"] ||
        headers["x-admin-secret".toLowerCase()] ||
        "";
    }
  } else {
    // Tutti gli altri metodi NON sono permessi
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
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