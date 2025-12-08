exports.handler = async (event) => {
  // Permettiamo solo POST dal form
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  let secretFromClient = "";

  try {
    const body = JSON.parse(event.body || "{}");

    // Accettiamo diversi possibili nomi di campo, così siamo sicuri
    const { secret, adminSecret, password, code } = body;

    secretFromClient = secret || adminSecret || password || code || "";
  } catch (err) {
    console.error("Errore parsing body:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: "Bad request" }),
    };
  }

  const adminKey = process.env.ADMIN_DASHBOARD_KEY || "";

  // Funzione di normalizzazione: niente null/undefined, niente spazi ai lati
  const normalize = (s) => (s || "").trim();

  const normalizedClient = normalize(secretFromClient);
  const normalizedServer = normalize(adminKey);

  if (!normalizedServer) {
    console.error("ADMIN_DASHBOARD_KEY non è impostata su Netlify!");
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: "Server misconfigured (missing admin key)",
      }),
    };
  }

  // Confronto dopo normalizzazione
  if (normalizedClient === normalizedServer) {
    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true }),
    };
  }

  // Debug “soft”: nessun valore, solo lunghezze
  return {
    statusCode: 401,
    body: JSON.stringify({
      ok: false,
      error: "Invalid secret",
      clientLength: normalizedClient.length,
      serverLength: normalizedServer.length,
    }),
  };
};