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
    // ⚠️ il campo si chiama "secret" nel fetch dal form React
    secretFromClient = body.secret || "";
  } catch (err) {
    console.error("Errore parsing body:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ ok: false, error: "Bad request" }),
    };
  }

  const adminKey = process.env.ADMIN_DASHBOARD_KEY;

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