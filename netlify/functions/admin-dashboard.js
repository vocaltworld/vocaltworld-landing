const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../server/data");
const SURVEYS_FILE = path.join(DATA_DIR, "surveys.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");

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

  if (normalizedClient === normalizedServer) {
    try {
      // Leggo i dati dei sondaggi
      let surveys = [];
      let stats = {
        total: 0,
        interested: 0,
        notInterested: 0,
        interestedPercent: 0,
        notInterestedPercent: 0,
      };

      try {
        const surveysRaw = await fs.readFile(SURVEYS_FILE, "utf8");
        if (surveysRaw) {
          surveys = JSON.parse(surveysRaw);
        }
      } catch (err) {
        console.error("Errore lettura surveys.json:", err);
      }

      try {
        const statsRaw = await fs.readFile(STATS_FILE, "utf8");
        if (statsRaw) {
          stats = JSON.parse(statsRaw);
        }
      } catch (err) {
        console.error("Errore lettura stats.json:", err);
      }

      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          surveys,
          stats,
        }),
      };
    } catch (err) {
      console.error("Errore lettura dati dashboard:", err);
      return {
        statusCode: 500,
        body: JSON.stringify({
          ok: false,
          error: "Dashboard read error",
        }),
      };
    }
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