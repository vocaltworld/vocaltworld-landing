const fs = require("fs").promises;
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "server", "data");
const SURVEYS_FILE = path.join(DATA_DIR, "surveys.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");

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

    // 3️⃣ Leggo surveys.json e stats.json generati dalla Netlify Function submit-survey
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
        surveys = JSON.parse(surveysRaw || "[]");
      }
    } catch (err) {
      console.warn("Impossibile leggere surveys.json:", err.message);
    }

    try {
      const statsRaw = await fs.readFile(STATS_FILE, "utf8");
      if (statsRaw) {
        stats = JSON.parse(statsRaw || "{}");
      }
    } catch (err) {
      console.warn("Impossibile leggere stats.json, uso valori di default:", err.message);
    }

    // Ordiniamo i risultati per data (più recenti in alto)
    surveys.sort((a, b) => {
      const da = new Date(a.createdAt || a.date || 0);
      const db = new Date(b.createdAt || b.date || 0);
      return db - da;
    });

    // 4️⃣ Risposta nel formato atteso dalla dashboard
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        stats,
        surveys,
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