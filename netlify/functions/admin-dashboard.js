// netlify/functions/admin-dashboard.js

// Per chiamare Klaviyo
const fetch = (...args) =>
  import("node-fetch").then(({ default: f }) => f(...args));

// Per il fallback sui file locali
const fs = require("fs/promises");
const path = require("path");

const SURVEYS_FILE = path.join(
  __dirname,
  "..",
  "..",
  "server",
  "data",
  "surveys.json"
);
const STATS_FILE = path.join(
  __dirname,
  "..",
  "..",
  "server",
  "data",
  "stats.json"
);

// Funzione di helper: carica dati dai file locali
async function loadFromFiles() {
  try {
    const [surveysRaw, statsRaw] = await Promise.all([
      fs.readFile(SURVEYS_FILE, "utf8"),
      fs.readFile(STATS_FILE, "utf8"),
    ]);

    const surveys = JSON.parse(surveysRaw || "[]");
    const stats = JSON.parse(statsRaw || "{}");

    return { surveys, stats };
  } catch (err) {
    console.error("Errore caricando i file locali della dashboard:", err);

    // Ritorno qualcosa di “vuoto” ma valido
    return {
      surveys: [],
      stats: {
        total: 0,
        interested: 0,
        notInterested: 0,
        interestedPercent: 0,
        notInterestedPercent: 0,
      },
    };
  }
}

// Funzione di helper: carica e trasforma i dati da Klaviyo
async function loadFromKlaviyo(klaviyoKey, listId) {
  // 🔎 prendiamo TUTTI i membri della lista da Klaviyo (API v2)
  const url = `https://a.klaviyo.com/api/v2/list/${listId}/members/all?api_key=${klaviyoKey}`;
  const res = await fetch(url);

  if (!res.ok) {
    const text = await res.text();
    console.error("Errore Klaviyo:", res.status, text);
    throw new Error("Errore nel recupero dati da Klaviyo");
  }

  const payload = await res.json();
  const records = payload.records || payload || [];
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
          console.warn("Impossibile fare JSON.parse di survey_answers:", e);
        }
      } else if (typeof props.survey_answers === "object") {
        answers = props.survey_answers;
      }
    }

    const score = props.survey_score ?? null;
    const level = props.survey_level || "";
    const levelLower = String(level).toLowerCase();

    const interested =
      levelLower === "speaker" ||
      levelLower === "interessato" ||
      levelLower === "molto interessato";

    return {
      email: r.email,
      createdAt: props.survey_completed_at || props.$last_event_time || null,
      score,
      level,
      interested,
      answers: {
        usageFrequency: answers.usageFrequency || answers.usage_frequency,
        mainUseCase: answers.mainUseCase || answers.main_use_case,
        offlineInterest: answers.offlineInterest || answers.offline_interest,
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

  return { surveys, stats };
}

exports.handler = async (event) => {
  // permetti solo POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  // 🔐 controllo secret dall'admin
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

  // 🔑 variabili per Klaviyo
  const klaviyoKey = process.env.KLAVIYO_PRIVATE_KEY;
  const listId = process.env.KLAVIYO_LIST_ID;

  try {
    // Se mancano le env di Klaviyo, forzo subito il fallback su file
    if (!klaviyoKey || !listId) {
      console.warn(
        "KLAVIYO_PRIVATE_KEY o KLAVIYO_LIST_ID mancanti: uso i file locali"
      );
      const { surveys, stats } = await loadFromFiles();
      return {
        statusCode: 200,
        body: JSON.stringify({
          ok: true,
          stats,
          surveys,
          source: "local",
        }),
      };
    }

    // 1️⃣ Provo con Klaviyo
    const { surveys, stats } = await loadFromKlaviyo(klaviyoKey, listId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        stats,
        surveys,
        source: "klaviyo",
      }),
    };
  } catch (err) {
    // 2️⃣ Se Klaviyo fallisce, faccio fallback sui file
    console.error("Errore generico admin-dashboard, fallback su file locali:", err);

    const { surveys, stats } = await loadFromFiles();

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        stats,
        surveys,
        source: "local-fallback",
      }),
    };
  }
};