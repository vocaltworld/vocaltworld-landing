
// netlify/functions/submit-survey.js

const fs = require("fs/promises");
const path = require("path");

const DATA_DIR = path.join(__dirname, "../../server/data");
const SURVEYS_FILE = path.join(DATA_DIR, "surveys.json");
const STATS_FILE = path.join(DATA_DIR, "stats.json");

exports.handler = async (event, context) => {
  console.log("Request from:", event.httpMethod, event.path);
  console.log(
    "Env KLAVIYO_PRIVATE_KEY presente?:",
    !!process.env.KLAVIYO_PRIVATE_KEY
  );
  console.log(
    "Env KLAVIYO_LIST_ID presente?:",
    !!process.env.KLAVIYO_LIST_ID
  );

  // ✅ Consenti solo POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  // ✅ Parse del body
  let payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (err) {
    console.error("JSON parse error:", err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Invalid JSON body" }),
    };
  }

  const {
    usageFrequency,
    offlineInterest,
    mainUseCase,
    priceRange,
    extraNote,
    email,
    consent, // checkbox “Accetto di ricevere email…”
    communicationDifficulty, // nuova domanda 1
    currentSolution, // nuova domanda 2
    instantOfflineInterest, // nuova domanda 3
  } = payload || {};

  console.log("Payload ricevuto:", payload);

  // ✅ Controllo minimo: serve almeno l'email
  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing email" }),
    };
  }

  const normalizedEmail = email.trim().toLowerCase();

    // 🔍 Validazione formato email (gratuita, prima di servizi esterni)
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // Lista di pattern "troppo palesi" usati spesso come email finte
  const fakeLocalParts = [
    "test",
    "prova",
    "provamail",
    "fake",
    "asdf",
    "qwerty",
    "pippo",
    "ciao",
  ];

  const fakeDomains = [
    "example.com",
    "test.com",
    "mailinator.com",
    "tempmail.com",
    "ciao.com",
  ];

  const [localPart, domainPart] = normalizedEmail.split("@");

  // 1) formato base non valido
  if (!emailRegex.test(normalizedEmail) || !localPart || !domainPart) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "invalid_email_format",
        message: "Per favore inserisci un'email valida.",
      }),
    };
  }

  // 2) blocco di alcune combinazioni troppo chiaramente "fake"
  if (
    fakeLocalParts.includes(localPart) ||
    fakeDomains.includes(domainPart)
  ) {
    console.log("Email bloccata da filtro anti-fake:", normalizedEmail);
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "invalid_email_format",
        message: "Per favore inserisci un'email valida.",
      }),
    };
  }

  // 🔍 Controllo campi obbligatori del sondaggio (gratis)
  if (
    !usageFrequency ||
    !offlineInterest ||
    !mainUseCase ||
    !priceRange ||
    !communicationDifficulty ||
    !currentSolution ||
    !instantOfflineInterest
  ) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: "missing_fields",
        message: "Compila tutte le domande obbligatorie del sondaggio.",
      }),
    };
  }

  // 🔐 Rate limiting base per IP (protezione da abusi/bot)
  const clientIp =
    (event.headers &&
      (event.headers["x-nf-client-connection-ip"] ||
        event.headers["x-forwarded-for"] ||
        event.headers["client-ip"])) ||
    "unknown";

  if (!globalThis.__rateLimitMap) {
    globalThis.__rateLimitMap = {};
  }

  const windowMs = 10 * 1000; // finestra di 10 secondi
  const maxRequests = 5; // max 5 richieste ogni 10s per IP
  const now = Date.now();
  const entry = globalThis.__rateLimitMap[clientIp] || {
    count: 0,
    time: now,
  };

  if (now - entry.time < windowMs) {
    entry.count += 1;
  } else {
    entry.count = 1;
    entry.time = now;
  }

  globalThis.__rateLimitMap[clientIp] = entry;

  if (entry.count > maxRequests) {
    console.warn(
      "Rate limit superato per IP:",
      clientIp,
      "count:",
      entry.count
    );
    return {
      statusCode: 429,
      body: JSON.stringify({
        error: "too_many_requests",
        message:
          "Stai inviando troppe richieste in poco tempo. Riprova tra qualche istante.",
      }),
    };
  }

  // --- Calcolo score 1–10 in base alle risposte ---

  // Domande originali
  const mapUsage = {
    Spesso: 3,
    "A volte": 2,
    Raramente: 1,
    Mai: 0,
  };

  const mapOffline = {
    Moltissimo: 3,
    Abbastanza: 2,
    Poco: 1,
    "Per niente": 0,
  };

  // Nuove domande (3 domande aggiuntive)
  const mapDifficulty = {
    "Sì, spesso": 3,
    "Sì, alcune volte": 2,
    Raramente: 1,
    Mai: 0,
  };

  const mapSolution = {
    "Nessun'app: mi arrangio": 3,
    "Un dispositivo fisico": 2,
    "Google Translate": 1,
    "App di traduzione con microfono": 0,
    Altro: 0,
  };

  const mapInstantInterest = {
    "Sì, mi interessa molto": 3,
    "Potrebbe interessarmi": 2,
    "Non lo so": 1,
    "Poco interessato": 0,
    "Non mi interessa": 0,
  };

  let rawScore = 0;

  // peso maggiore a frequenza + interesse offline (moltiplicati x2)
  rawScore += (mapUsage[usageFrequency] || 0) * 2;
  rawScore += (mapOffline[offlineInterest] || 0) * 2;

  // Nuove domande: pesi lineari
  rawScore += mapDifficulty[communicationDifficulty] || 0;
  rawScore += mapSolution[currentSolution] || 0;
  rawScore += mapInstantInterest[instantOfflineInterest] || 0;

  // Se ha scelto un use case → aggiungo 1 punto
  if (mainUseCase) rawScore += 1;

  // Se ha scritto una nota → aggiungo 1 punto
  if (extraNote && extraNote.trim().length > 0) rawScore += 1;

  // rawScore teorico massimo:
  // usage (3*2=6) + offline (3*2=6) + 3 + 3 + 3 + 1 + 1 = 23
  // normalizzo a 1–10
  let score = Math.round((rawScore / 23) * 10);

  if (score < 1) score = 1;
  if (score > 10) score = 10;

  // --- Determina livello ---
  // Alleggerito: includiamo anche gli score 5–6 come "Listener",
  // così i profili medi ma potenzialmente curiosi non vengono esclusi dai flow.
  let level = null;
  if (score >= 9) level = "Pioneer"; // 9–10
  else if (score >= 7) level = "Speaker"; // 7–8
  else if (score >= 5) level = "Listener"; // 5–6
  // <= 4 => level rimane null (profilo freddo, fuori dai flow iniziali)

  console.log("Score calcolato:", score, "Level:", level, "Consent:", consent);

  // 🔹 Salviamo le risposte REALI che arrivano dal form
  const surveyAnswers = {
    usageFrequency,
    offlineInterest,
    mainUseCase,
    priceRange,
    extraNote,
    communicationDifficulty,
    currentSolution,
    instantOfflineInterest,
  };

  // Data/ora in cui il sondaggio è stato completato
  // Se il profilo esiste già e ha già una survey_completed_at, la riutilizziamo
  let surveyCompletedAt = new Date().toISOString();

  // --- Chiavi Klaviyo ---
  const apiKey = process.env.KLAVIYO_PRIVATE_KEY;
  const listId = process.env.KLAVIYO_LIST_ID;

  if (!apiKey) {
    console.error("KLAVIYO_PRIVATE_KEY mancante nell'ambiente Netlify");
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Missing Klaviyo private key" }),
    };
  }

  try {
    // 1️⃣ NO REFOUND: controllo se c'è già un profilo con questa email
    const existingRes = await fetch(
      `https://a.klaviyo.com/api/profiles/?filter=equals(email,"%22${normalizedEmail}%22")`,
      {
        method: "GET",
        headers: {
          Authorization: `Klaviyo-API-Key ${apiKey}`,
          Accept: "application/json",
          Revision: "2024-07-15",
        },
      }
    );

    const existingData = await existingRes.json().catch(() => ({}));
    const existingProfile = existingData.data && existingData.data[0];

    // Se il profilo esiste e ha già una survey_completed_at, non la sovrascriviamo
    if (
      existingProfile &&
      existingProfile.attributes &&
      existingProfile.attributes.properties &&
      existingProfile.attributes.properties.survey_completed_at
    ) {
      surveyCompletedAt =
        existingProfile.attributes.properties.survey_completed_at;
    }

    if (
      existingProfile &&
      existingProfile.attributes &&
      existingProfile.attributes.properties
    ) {
      const props = existingProfile.attributes.properties;

      // se ha già un punteggio o un flag, non accetto un nuovo sondaggio
      if (props.survey_score || props.survey_completed === true) {
        return {
          statusCode: 409,
          body: JSON.stringify({
            error: "already_submitted",
            message: "Hai già compilato il sondaggio. Grazie!",
          }),
        };
      }
    }

    // 🔹 Validazione email tramite Kickbox (dopo controlli gratuiti e check profilo esistente)
    const kickboxApiKey = process.env.KICKBOX_API_KEY;
    console.log("Kickbox key presente:", !!kickboxApiKey);

    if (kickboxApiKey) {
      try {
        const verificationRes = await fetch(
          `https://api.kickbox.com/v2/verify?email=${encodeURIComponent(
            normalizedEmail
          )}&apikey=${kickboxApiKey}`
        );

        const verificationData = await verificationRes.json();
        console.log("Kickbox status:", verificationRes.status);
        console.log("Kickbox data:", verificationData);

        // Se Kickbox risponde con errore (es. 401, 403, problemi di crediti, ecc.),
        // blocchiamo il sondaggio e mostriamo un errore tecnico.
        if (!verificationRes.ok) {
          console.error(
            "Kickbox non ha validato correttamente (status ",
            verificationRes.status,
            ")."
          );

          return {
            statusCode: 502,
            body: JSON.stringify({
              error: "kickbox_error",
              message:
                "C'è un problema con il sistema di verifica email. Riprova tra qualche minuto.",
            }),
          };
        } else {
          const { result, disposable } = verificationData || {};

          // Accettiamo SOLO email marcate come "deliverable" e non disposable.
          // Tutto il resto (undeliverable, risky, unknown, disposable) viene bloccato.
          if (result !== "deliverable" || disposable === true) {
            console.log("Email bloccata da Kickbox:", normalizedEmail);

            return {
              statusCode: 400,
              body: JSON.stringify({
                error: "invalid_email",
                message:
                  "L'indirizzo email inserito non risulta valido o potrebbe non essere raggiungibile. Prova con un'altra email.",
              }),
            };
          }
        }
      } catch (err) {
        console.error("Errore Kickbox:", err);
        // In caso di errore di rete/interno Kickbox, blocchiamo per sicurezza.
        return {
          statusCode: 502,
          body: JSON.stringify({
            error: "kickbox_error",
            message:
              "Si è verificato un problema durante la verifica dell'email. Riprova più tardi.",
          }),
        };
      }
    } else {
      console.warn("KICKBOX_API_KEY non presente, salto validazione Kickbox.");
    }

    // 2️⃣ CREA / AGGIORNA IL PROFILO con le proprietà del sondaggio
    const profileRes = await fetch("https://a.klaviyo.com/api/profiles/", {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${apiKey}`,
        "Content-Type": "application/json",
        revision: "2024-07-15",
      },
      body: JSON.stringify({
        data: {
          type: "profile",
          attributes: {
            email: normalizedEmail,
            properties: {
              survey_score: score,
              survey_level: level,
              survey_answers: surveyAnswers,
              survey_completed: true,
              survey_completed_at: surveyCompletedAt,
            },
          },
        },
      }),
    });

    const profileText = await profileRes.text();
    let profileJson;
    try {
      profileJson = JSON.parse(profileText);
    } catch {
      profileJson = profileText;
    }

    console.log("Klaviyo PROFILE status:", profileRes.status);
    console.log("Klaviyo PROFILE response:", profileJson);
if (!profileRes.ok) {
  // Se Klaviyo risponde con 409 (conflitto / profilo già gestito),
  // lo mappiamo su "already_submitted" così il frontend può mostrare
  // il messaggio direttamente nella casella email.
  if (profileRes.status === 409) {
    return {
      statusCode: 409,
      body: JSON.stringify({
        error: "already_submitted",
        message:
          "Utente già registrato: questa email ha già compilato il sondaggio. Grazie!",
      }),
    };
  }

  // Tutti gli altri errori restano globali
  return {
    statusCode: 502,
    body: JSON.stringify({
      error: "Klaviyo API error (profile)",
      status: profileRes.status,
      details: profileJson,
    }),
  };
}

    // 3️⃣ SE HA DATO CONSENSO → SUBSCRIBE alla lista
    if (consent && listId) {
      const subRes = await fetch(
        "https://a.klaviyo.com/api/profile-subscription-bulk-create-jobs/",
        {
          method: "POST",
          headers: {
            Authorization: `Klaviyo-API-Key ${apiKey}`,
            "Content-Type": "application/json",
            accept: "application/json",
            revision: "2024-07-15",
          },
          body: JSON.stringify({
            data: {
              type: "profile-subscription-bulk-create-job",
              attributes: {
                profiles: {
                  data: [
                    {
                      type: "profile",
                      attributes: {
                        email: normalizedEmail,
                        subscriptions: {
                          email: {
                            marketing: {
                              consent: "SUBSCRIBED",
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
              relationships: {
                list: {
                  data: {
                    type: "list",
                    id: listId, // ID della tua “Email List”
                  },
                },
              },
            },
          }),
        }
      );

      const subText = await subRes.text();
      let subJson;
      try {
        subJson = JSON.parse(subText);
      } catch {
        subJson = subText;
      }

      console.log("Klaviyo SUBSCRIBE status:", subRes.status);
      console.log("Klaviyo SUBSCRIBE response:", subJson);

      if (!subRes.ok) {
        return {
          statusCode: 502,
          body: JSON.stringify({
            error: "Klaviyo API error (subscribe)",
            status: subRes.status,
            details: subJson,
          }),
        };
      }
    } else {
      console.log(
        "Nessuna iscrizione alla lista. consent=",
        consent,
        " listId presente? ",
        !!listId
      );
    }

    // 4️⃣ INVIO DEI DATI ALLA TUA DASHBOARD PERSONALE (sempre, indipendentemente dallo score)
    try {
      const dashboardUrl = process.env.DASHBOARD_WEBHOOK_URL;
      if (dashboardUrl) {
        const dashboardPayload = {
          email: normalizedEmail,
          score,
          level,
          consent: !!consent,
          surveyAnswers,
          surveyCompletedAt,
        };

        const dashRes = await fetch(dashboardUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(dashboardPayload),
        });

        const dashText = await dashRes.text();
        let dashJson;
        try {
          dashJson = JSON.parse(dashText);
        } catch {
          dashJson = dashText;
        }

        console.log("Dashboard status:", dashRes.status);
        console.log("Dashboard response:", dashJson);
      } else {
        console.log(
          "Nessuna DASHBOARD_WEBHOOK_URL configurata, salto invio alla dashboard."
        );
      }
    } catch (dashErr) {
      console.error("Errore durante l'invio dei dati alla dashboard:", dashErr);
      // Non blocchiamo l'utente se la dashboard fallisce, è solo logging interno
    }

    // ---------- Salvataggio dati per la dashboard ----------
    try {
      const interested = score >= 5; // stesso criterio usato nel resto della logica

      const newSurvey = {
        email: normalizedEmail,
        createdAt: new Date().toISOString(),
        score,
        interested, // true/false
        answers: {
          usageFrequency,
          mainUseCase,
          offlineInterest,
          priceRange,
          communicationDifficulty,
          currentSolution,
          instantOfflineInterest,
          extraNote,
        },
      };

      // Mi assicuro che la cartella esista
      await fs.mkdir(DATA_DIR, { recursive: true });

      // Leggo eventuali sondaggi precedenti
      let surveys = [];
      try {
        const raw = await fs.readFile(SURVEYS_FILE, "utf8");
        if (raw) {
          surveys = JSON.parse(raw);
        }
      } catch (readErr) {
        console.warn("surveys.json non trovato o non leggibile, ne creo uno nuovo:", readErr.message);
      }

      // Aggiungo il nuovo sondaggio in coda
      surveys.push(newSurvey);

      // calcoli stats (total, interestedCount, ecc...)
      const total = surveys.length;
      const interestedCount = surveys.filter((s) => s.interested).length;
      const notInterestedCount = total - interestedCount;

      const interestedPercent =
        total > 0 ? Math.round((interestedCount / total) * 100) : 0;
      const notInterestedPercent = 100 - interestedPercent;

      const stats = {
        total,
        interested: interestedCount,
        notInterested: notInterestedCount,
        interestedPercent,
        notInterestedPercent,
      };

      // salviamo su disco
      await fs.writeFile(SURVEYS_FILE, JSON.stringify(surveys, null, 2));
      await fs.writeFile(STATS_FILE, JSON.stringify(stats, null, 2));

      console.log("✅ Dati dashboard salvati (surveys.json / stats.json)");
    } catch (saveErr) {
      console.error("Errore salvataggio dati dashboard:", saveErr);
      // Non blocchiamo la risposta all'utente se fallisce il log interno
    }
    // ---------- fine salvataggio dashboard ----------
    // ✅ Tutto ok
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Survey submitted successfully",
        score,
        level,
        consent: !!consent,
      }),
    };
  } catch (err) {
    console.error("Errore generale Netlify function:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error" }),
    };
  }
};