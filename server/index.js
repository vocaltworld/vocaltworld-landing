// server/index.js

const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const PORT = 4000;

app.use(express.json());

// 📁 Percorsi file dati
const dataDir = path.join(__dirname, "data");
const surveysFile = path.join(dataDir, "surveys.json");
const statsFile = path.join(dataDir, "stats.json");

// Assicuro che la cartella e i file base esistano
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (!fs.existsSync(surveysFile)) {
  fs.writeFileSync(surveysFile, "[]", "utf-8");
}

if (!fs.existsSync(statsFile)) {
  const emptyStats = {
    total: 0,
    interested: 0,
    notInterested: 0,
    interestedPercent: 0,
    notInterestedPercent: 0,
  };
  fs.writeFileSync(statsFile, JSON.stringify(emptyStats, null, 2), "utf-8");
}

// 🔎 Funzione per calcolare interesse (logica legacy, usata solo come fallback)
function evaluateInterest(data) {
  const freqScore =
    {
      Spesso: 3,
      "A volte": 2,
      Raramente: 1,
      Mai: 0,
    }[data.usageFrequency] || 0;

  const offlineScore =
    {
      Moltissimo: 3,
      Abbastanza: 2,
      Poco: 1,
      "Per niente": 0,
    }[data.offlineInterest] || 0;

  const useCaseScore =
    {
      "Viaggi all'estero": 2,
      "Lavoro o studio": 2,
      "Relazioni o incontri": 2,
      Altro: 1,
    }[data.mainUseCase] || 0;

  const priceScore =
    {
      "50–100 €": 2,
      "100–200 €": 2,
      "< 50 €": 1,
      "> 200 €": 1,
    }[data.priceRange] || 0;

  const score = freqScore + offlineScore + useCaseScore + priceScore;
  const isInterested = score >= 7;

  return { score, isInterested };
}

// 📊 Aggiorna stats.json a partire dai sondaggi
function updateStats(surveys) {
  const total = surveys.length;
  const interested = surveys.filter((s) => s.isInterested).length;
  const notInterested = total - interested;

  const interestedPercent = total
    ? Math.round((interested / total) * 100)
    : 0;
  const notInterestedPercent = 100 - interestedPercent;

  const stats = {
    total,
    interested,
    notInterested,
    interestedPercent,
    notInterestedPercent,
  };

  fs.writeFileSync(statsFile, JSON.stringify(stats, null, 2), "utf-8");
}

// 📨 Endpoint ricezione sondaggi (usato come webhook dalla Netlify Function)
app.post("/api/survey", (req, res) => {
  try {
    const raw = req.body || {};

    // Se arriva dal webhook Netlify, il payload ha forma:
    // { email, score, level, consent, surveyAnswers: { ... }, surveyCompletedAt }
    // Normalizziamo in un unico oggetto `data`.
    let data = { ...raw };

    if (raw.surveyAnswers && typeof raw.surveyAnswers === "object") {
      data = {
        ...raw.surveyAnswers, // usageFrequency, offlineInterest, ecc.
        email: raw.email || raw.surveyAnswers.email,
        score: raw.score,
        level: raw.level,
        consent: raw.consent,
        surveyCompletedAt: raw.surveyCompletedAt,
      };
    }

    console.log("📩 /api/survey payload normalizzato:", data);

    // 1) Leggo il file con tutti i sondaggi esistenti
    let surveys = [];
    try {
      const surveysRaw = fs.readFileSync(surveysFile, "utf-8");
      surveys = surveysRaw ? JSON.parse(surveysRaw) : [];
    } catch (err) {
      console.error("Errore lettura surveysFile:", err);
      surveys = [];
    }

    // 2) Calcolo interestScore / isInterested
    // Priorità: usa lo score già calcolato dal backend, se presente
    let interestScore = 0;
    let isInterested = false;

    if (data.score !== undefined && data.score !== null) {
      const numericScore = Number(data.score);
      if (!Number.isNaN(numericScore)) {
        interestScore = numericScore;
        isInterested = numericScore >= 5; // 5–10 interessato (alleggerito)
      }
    } else {
      // fallback su logica legacy se mai mancasse lo score
      const legacy = evaluateInterest(data);
      interestScore = legacy.score;
      isInterested = legacy.isInterested;
    }

    // 3) Creo l'oggetto da salvare
    const entry = {
      ...data,
      interestScore,
      isInterested,
      createdAt: data.surveyCompletedAt || new Date().toISOString(),
    };

    // 4) Aggiungo il nuovo sondaggio
    surveys.push(entry);

    // 5) Scrivo il file aggiornato
    fs.writeFileSync(surveysFile, JSON.stringify(surveys, null, 2), "utf-8");

    // 6) Aggiorno le statistiche aggregate
    updateStats(surveys);

    // 7) Risposta alla dashboard
    return res.json({
      message: "Sondaggio salvato correttamente",
      isInterested,
      interestScore,
    });
  } catch (err) {
    console.error("Errore generale in /api/survey:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// 📥 Endpoint per ottenere tutti i sondaggi (usato dalla dashboard admin)
app.get("/api/surveys", (req, res) => {
  try {
    const surveysRaw = fs.readFileSync(surveysFile, "utf-8");
    const surveys = surveysRaw ? JSON.parse(surveysRaw) : [];
    return res.json({ surveys });
  } catch (err) {
    console.error("Errore lettura /api/surveys:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// 📊 Endpoint per ottenere le statistiche aggregate
app.get("/api/stats", (req, res) => {
  try {
    let stats = {
      total: 0,
      interested: 0,
      notInterested: 0,
      interestedPercent: 0,
      notInterestedPercent: 0,
    };

    if (fs.existsSync(statsFile)) {
      const statsRaw = fs.readFileSync(statsFile, "utf-8");
      stats = statsRaw ? JSON.parse(statsRaw) : stats;
    }

    return res.json(stats);
  } catch (err) {
    console.error("Errore lettura /api/stats:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
});

// 🚀 Avvio server
app.listen(PORT, () => {
  console.log(`🚀 Vocal T World API attiva su http://localhost:${PORT}`);
});