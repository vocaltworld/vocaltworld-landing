import React, { useEffect, useMemo, useRef, useState } from "react";

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString("it-IT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function displayEmail(v) {
  const s = (v ?? "").toString().trim();
  if (!s || s === "-") return "Anonimo";
  return s;
}

function parseNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return null;
}

function getLastResponseInfo(surveys) {
  if (!surveys || surveys.length === 0) return null;

  const latest = surveys.reduce((acc, s) => {
    if (!acc) return s;
    const d1 = new Date(s.createdAt || s.surveyCompletedAt || s.date);
    const d2 = new Date(acc.createdAt || acc.surveyCompletedAt || acc.date);
    return d1 > d2 ? s : acc;
  }, null);

  const lastIso = latest?.createdAt || latest?.surveyCompletedAt || latest?.date;
  if (!lastIso) return null;

  const lastDate = new Date(lastIso);
  const now = new Date();
  const diffMs = now - lastDate;
  const diffMin = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let label;
  let isFresh = false;

  if (diffDays >= 1) {
    const formatted = lastDate.toLocaleString("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
    label = `Ultimo sondaggio: ${formatted}`;
  } else if (diffHours >= 1) {
    label = `Nuovo sondaggio ${diffHours}h fa`;
    isFresh = true;
  } else if (diffMin >= 1) {
    label = `Nuovo sondaggio ${diffMin} minuti fa`;
    isFresh = true;
  } else {
    label = "Nuovo sondaggio adesso";
    isFresh = true;
  }

  return { label, isFresh };
}

function pick(obj, key, fallback = undefined) {
  return obj && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : fallback;
}

/**
 * 🔥 NORMALIZZAZIONE CORRETTA PER IL TUO BACKEND:
 * - molte risposte stanno in raw.answers.survey_answers
 * - score sta spesso in raw.answers.survey_score
 * - unifica campi e calcola Interested = score >= 6
 */
function getEmailSubscribed(raw) {
  // ✅ Priorità 0: se il backend (Netlify Function) ci passa già il boolean, usalo.
  // (admin-dashboard.js restituisce `isEmailSubscribed` in camelCase)
  if (typeof raw?.isEmailSubscribed === "boolean") return raw.isEmailSubscribed;
  if (typeof raw?.email_subscribed === "boolean") return raw.email_subscribed;
  if (typeof raw?.emailSubscribed === "boolean") return raw.emailSubscribed;

  // ✅ Priorità 1: consenso esplicito Klaviyo (spesso arriva in raw.answers.$consent)
  const rawAnswers = raw?.answers && typeof raw.answers === "object" ? raw.answers : {};
  const consentArr =
    (Array.isArray(raw?.$consent) ? raw.$consent : null) ??
    (Array.isArray(rawAnswers?.$consent) ? rawAnswers.$consent : null) ??
    (Array.isArray(rawAnswers?.consent) ? rawAnswers.consent : null);

  if (Array.isArray(consentArr)) {
    // Se include "email" consideriamo l’utente iscritto/consenziente alle email
    if (consentArr.map((x) => String(x).toLowerCase()).includes("email")) return true;
  }

  // ✅ Priorità 2: stato subscription (alcuni export lo mettono qui)
  const status1 = raw?.subscriptions?.email?.marketing?.status; // "SUBSCRIBED"
  const status2 = raw?.subscriptions?.email?.status; // alternativa
  const status3 = raw?.email_status; // alternativa custom

  const status = (status1 || status2 || status3 || "").toString().toUpperCase();
  if (status === "SUBSCRIBED") return true;

  return false;
}
function normalizeSurvey(raw) {
  // 1) blocchi possibili di "answers"
  const rawAnswers = raw?.answers && typeof raw.answers === "object" ? raw.answers : {};

  const surveyAnswers =
    (rawAnswers?.survey_answers && typeof rawAnswers.survey_answers === "object" ? rawAnswers.survey_answers : null) ||
    (rawAnswers?.surveyAnswers && typeof rawAnswers.surveyAnswers === "object" ? rawAnswers.surveyAnswers : null) ||
    (raw?.survey_answers && typeof raw.survey_answers === "object" ? raw.survey_answers : null) ||
    {};

  // 2) answers "finali" (solo risposte vere)
  const answers = { ...surveyAnswers };

  // Stato iscrizione email (Klaviyo consent/subscription)
  const isEmailSubscribed = getEmailSubscribed(raw);

  // 3) email + date coerenti
  const email =
    raw?.email ??
    rawAnswers?.email ??
    surveyAnswers?.email ??
    raw?.properties?.email ??
    raw?.profile?.email ??
    "-";

  const createdAt =
    raw?.createdAt ??
    raw?.surveyCompletedAt ??
    raw?.date ??
    rawAnswers?.createdAt ??
    rawAnswers?.surveyCompletedAt ??
    rawAnswers?.timestamp ??
    null;

  // 4) score: prima survey_score, poi score/interestScore vari
  const rawScore =
    parseNumber(rawAnswers?.survey_score) ??
    parseNumber(rawAnswers?.score) ??
    parseNumber(raw?.score) ??
    parseNumber(surveyAnswers?.score) ??
    parseNumber(rawAnswers?.interestScore) ??
    parseNumber(raw?.interestScore) ??
    parseNumber(surveyAnswers?.interestScore);

  const rawInterestScore =
    parseNumber(rawAnswers?.interestScore) ??
    parseNumber(raw?.interestScore) ??
    parseNumber(surveyAnswers?.interestScore);

  // 5) mismatch fix: interestScore 0 ma score > 0
  let normalizedInterestScore = null;
  if (typeof rawInterestScore === "number") {
    if (rawInterestScore === 0 && typeof rawScore === "number" && rawScore > 0) {
      normalizedInterestScore = rawScore;
    } else {
      normalizedInterestScore = rawInterestScore;
    }
  } else if (typeof rawScore === "number") {
    normalizedInterestScore = rawScore;
  }

  // 6) isInterested: proprietà se esiste, altrimenti score >= 6
  const rawIsInterested =
    (typeof raw?.isInterested === "boolean" ? raw.isInterested : null) ??
    (typeof raw?.interested === "boolean" ? raw.interested : null) ??
    (typeof rawAnswers?.isInterested === "boolean" ? rawAnswers.isInterested : null) ??
    (typeof rawAnswers?.interested === "boolean" ? rawAnswers.interested : null) ??
    (typeof surveyAnswers?.isInterested === "boolean" ? surveyAnswers.isInterested : null) ??
    (typeof surveyAnswers?.interested === "boolean" ? surveyAnswers.interested : null);

  const computedIsInterested =
    typeof normalizedInterestScore === "number" ? normalizedInterestScore >= 6 : false;

  const normalizedIsInterested =
    typeof rawIsInterested === "boolean" ? rawIsInterested : computedIsInterested;

  // 7) mappatura chiavi “comuni” (se arrivano con nomi diversi)
  // (Qui manteniamo anche compatibilità con eventuali profili vecchi)
  const mapped = {
    usageFrequency:
      pick(answers, "usageFrequency", pick(answers, "Usage Frequency", pick(rawAnswers, "usageFrequency"))),
    offlineInterest:
      pick(answers, "offlineInterest", pick(answers, "Offline Interest", pick(rawAnswers, "offlineInterest"))),
    mainUseCase:
      pick(answers, "mainUseCase", pick(answers, "Main Use Case", pick(rawAnswers, "mainUseCase"))),
    priceRange:
      pick(answers, "priceRange", pick(answers, "Price Range", pick(rawAnswers, "priceRange"))),
    extraNote:
      pick(answers, "extraNote", pick(answers, "Extra Note", pick(rawAnswers, "extraNote"))),
    communicationDifficulty:
      pick(answers, "communicationDifficulty", pick(answers, "Communication Difficulty", pick(rawAnswers, "communicationDifficulty"))),
    currentSolution:
      pick(answers, "currentSolution", pick(answers, "Current Solution", pick(rawAnswers, "currentSolution"))),
    instantOfflineInterest:
      pick(answers, "instantOfflineInterest", pick(answers, "Instant Offline Interest", pick(rawAnswers, "instantOfflineInterest"))),
  };

  // 8) hasSurvey: solo dopo che answers/rawScore sono disponibili
  const hasSurvey =
    raw?.survey_completed === true ||
    !!raw?.survey_completed ||
    (answers && Object.keys(answers).length > 0) ||
    typeof rawScore === "number" ||
    typeof rawInterestScore === "number";

  return {
    ...raw,
    // risposte vere (survey_answers)
    answers,
    // campi comodi top-level per UI
    ...mapped,

    email,
    createdAt,
    surveyCompletedAt: raw?.surveyCompletedAt ?? createdAt,

    _rawScore: rawScore,
    _rawInterestScore: rawInterestScore,

    normalizedInterestScore,
    normalizedIsInterested,
    hasSurvey,
    isEmailSubscribed,
  };
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  const [surveys, setSurveys] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedSurvey, setSelectedSurvey] = useState(null);
  const [lastRowId, setLastRowId] = useState(null);

  // ---------------------------
  // Micro-polls (mini sondaggi)
  // ---------------------------
  const [isMicroOpen, setIsMicroOpen] = useState(false);
  const [microQuestions, setMicroQuestions] = useState([]);
  const [microSelectedId, setMicroSelectedId] = useState("");
  const [microStats, setMicroStats] = useState(null);
  const [microRows, setMicroRows] = useState([]);
  const [microLoading, setMicroLoading] = useState(false);
  const [microError, setMicroError] = useState("");
  const microPollingRef = useRef(null);
    const microRowsBodyRef = useRef(null); // body tabella micro-poll (scroll)
const surveysTableBodyRef = useRef(null); // body tabella partecipanti
const microSelectedIdRef = useRef(""); // evita closure stale nel polling
const microSigRef = useRef("");          // firma dati micro-poll (anti-flicker)
const microLastUpdatedRef = useRef(0);   // timestamp ultimo update (solo per UI)
  const [microLastUpdatedAt, setMicroLastUpdatedAt] = useState(null);
  useEffect(() => {
  microSelectedIdRef.current = microSelectedId || "";
}, [microSelectedId]);
useEffect(() => {
  microSigRef.current = ""; // quando cambi domanda, forza refresh dati
}, [microSelectedId]);

// Normalizza la choice del micro-poll (supporta 1..4 e vari alias)
function normalizeMicroChoice(v) {
  const c = String(v ?? "").trim().toLowerCase();
  if (c === "1" || c === "yes" || c === "si" || c === "y") return "1";
  if (c === "2" || c === "no" || c === "n") return "2";
  if (c === "3") return "3";
  if (c === "4") return "4";
  return "";
}
// Key stabile per righe micro-poll (evita re-mount e flicker)
function microRowKey(r) {
  const k =
    r?.token_id ||
    r?.tokenId ||
    r?.voter_hash ||
    r?.voterHash ||
    `${r?.question_id || ""}__${r?.created_at || r?.createdAt || ""}__${r?.email || ""}`;
  return String(k);
}
  // Polling silenzioso (senza refresh pagina) + mantenimento selezione dettaglio
  const pollingRef = useRef(null);
  const selectedKeyRef = useRef(null);

  // ---------------------------
  // View state for dashboard/micro-polls
  // ---------------------------
  const [view, setView] = useState("main"); // "main" | "micro"

  const lastFetchAtRef = useRef(0);
  const lastKeysRef = useRef(new Set());
  const [newItems, setNewItems] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);

  // ---------------------------
  // ✅ EXPORT CSV (pro)
  // ---------------------------
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportMain, setExportMain] = useState(true);
  // Micro-polls export separati (Speaker / Listener)
  const [exportMicroSpeaker, setExportMicroSpeaker] = useState(true);
  const [exportMicroListener, setExportMicroListener] = useState(true);

  // ---------------------------
  // ✅ RESET RISPOSTE (solo dati di test) – 2 step (UI confirm + email confirm)
  // ---------------------------
  const RESET_CONFIRM_EMAIL = "resetdatabasevocaltworld@gmail.com";
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetErr, setResetErr] = useState("");
  const [resetOk, setResetOk] = useState("");
  const [resetTyped, setResetTyped] = useState("");

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function isoDateForFile(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}_${pad2(d.getHours())}${pad2(
      d.getMinutes()
    )}`;
  }

  function csvEscape(v) {
    const s = (v ?? "").toString();
    const escaped = s.replace(/"/g, '""');
    if (/[;\n"]/g.test(escaped)) return `"${escaped}"`;
    return escaped;
  }

  function rowsToCsv(rows, { delimiter = ";" } = {}) {
    const lines = rows.map((r) => r.map(csvEscape).join(delimiter));
    // BOM UTF-8 per Excel
    return "\uFEFF" + lines.join("\n");
  }
  // ---------------------------
// Micro-polls helpers (flow + labels)
// ---------------------------
function inferMicroFlowFromQuestion(q) {
  const flow = String(q?.flow || "").trim().toLowerCase();
  if (flow === "speaker" || flow === "listener" || flow === "pioneer") return flow;

  // fallback: se ha option_3/option_4 è un multi-option => listener
  const o3 = String(q?.option_3 ?? "").trim();
  const o4 = String(q?.option_4 ?? "").trim();
  if (o3 || o4) return "listener";

  return "speaker";
}

function getMicroQuestionLabel(q) {
  const flow = inferMicroFlowFromQuestion(q);
  const questionText = String(q?.question || "").trim();
  const shortId = String(q?.id || "").slice(0, 6);
  return `${flow} — ${questionText || "Domanda"} (${shortId || "id"})`;
}

function getMicroQuestionOptions(q) {
  const o1 = String(q?.option_1 ?? q?.option_yes ?? "Sì");
  const o2 = String(q?.option_2 ?? q?.option_no ?? "No");
  const o3 = String(q?.option_3 ?? "");
  const o4 = String(q?.option_4 ?? "");
  return { o1, o2, o3, o4, isFour: !!String(o3).trim() || !!String(o4).trim() };
}

function microChoiceToLabel(choice, q) {
  const c = normalizeMicroChoice(choice);
  const { o1, o2, o3, o4 } = getMicroQuestionOptions(q);
  if (c === "1") return o1 || "Opzione 1";
  if (c === "2") return o2 || "Opzione 2";
  if (c === "3") return (o3 && o3.trim()) ? o3 : "Opzione 3";
  if (c === "4") return (o4 && o4.trim()) ? o4 : "Opzione 4";
  return "-";
}

  function downloadTextFile(filename, content, mime = "text/csv;charset=utf-8") {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function buildMainDashboardCsv() {
    const header = [
      "email",
      "data_compilazione",
      "score",
      "interessato",
      "iscrizione_email",
      "uso_principale",
      "frequenza_uso",
      "interesse_offline",
      "fascia_prezzo",
      "difficolta_comunicazione",
      "soluzione_attuale",
      "interesse_immediato_offline",
      "note_extra",
    ];

    const body = (surveys || []).map((s) => [
      displayEmail(s.email),
      formatDate(s.createdAt || s.surveyCompletedAt || s.date),
      typeof s.normalizedInterestScore === "number" ? s.normalizedInterestScore : "",
      s.normalizedIsInterested ? "SI" : "NO",
      s.isEmailSubscribed ? "SI" : "NO",
      s.mainUseCase ?? "",
      s.usageFrequency ?? "",
      s.offlineInterest ?? "",
      s.priceRange ?? "",
      s.communicationDifficulty ?? "",
      s.currentSolution ?? "",
      s.instantOfflineInterest ?? "",
      s.extraNote ?? "",
    ]);

    const summary = [
      ["--- RIEPILOGO ---"],
      ["totale", stats?.total ?? ""],
      ["interessati", stats?.interested ?? ""],
      ["interessati_percent", stats?.interestedPercent ?? ""],
      ["non_interessati", stats?.notInterested ?? ""],
      ["non_interessati_percent", stats?.notInterestedPercent ?? ""],
    ];

    const rows = [header, ...body, [""], ...summary];
    return rowsToCsv(rows, { delimiter: ";" });
  }

 function buildMicroPollCsv({ question, rows, stats }) {
  const qLabel = getMicroQuestionLabel(question);
  const qText = String(question?.question || "");
  const qid = String(question?.id || "");

  // Stats: compatibile sia con vecchio (yes/no) sia nuovo (c1..c4)
  const total = stats?.total ?? 0;
  const c1 = stats?.c1 ?? stats?.count1 ?? stats?.yes ?? 0;
  const c2 = stats?.c2 ?? stats?.count2 ?? stats?.no ?? 0;
  const c3 = stats?.c3 ?? stats?.count3 ?? 0;
  const c4 = stats?.c4 ?? stats?.count4 ?? 0;

  const p1 = stats?.pct1 ?? stats?.pctYes ?? 0;
  const p2 = stats?.pct2 ?? stats?.pctNo ?? 0;
  const p3 = stats?.pct3 ?? 0;
  const p4 = stats?.pct4 ?? 0;

  const { o1, o2, o3, o4, isFour } = getMicroQuestionOptions(question);

  const meta = [
    ["--- MICRO-POLL ---"],
    ["label", qLabel],
    ["domanda", qText],
    ["question_id", qid],
    [""],
    ["totale_voti", total],
    ["1", `${o1 || "Opzione 1"} | ${c1} | ${p1}%`],
    ["2", `${o2 || "Opzione 2"} | ${c2} | ${p2}%`],
  ];

  if (isFour) {
    meta.push(["3", `${(o3 || "Opzione 3")} | ${c3} | ${p3}%`]);
    meta.push(["4", `${(o4 || "Opzione 4")} | ${c4} | ${p4}%`]);
  }

  meta.push([""]);

  const header = ["email", "data", "scelta"];
  const body = (rows || []).map((r) => {
    return [
      displayEmail(r.email),
      formatDate(r.created_at || r.createdAt),
      microChoiceToLabel(r.choice, question),
    ];
  });

  return rowsToCsv([...meta, header, ...body], { delimiter: ";" });
}

  async function doExport() {
    try {
      const stamp = isoDateForFile(new Date());

      if (exportMain) {
        const csv = buildMainDashboardCsv();
        downloadTextFile(`vocaltworld_dashboard_${stamp}.csv`, csv);
      }

      // Helper: trova domanda per flow (speaker/listener)
      const findQuestionByFlow = (flow) => {
        const f = String(flow || "").toLowerCase();
        const byFlow = (microQuestions || []).find(
          (q) => String(q?.flow || "").toLowerCase() === f
        );
        if (byFlow) return byFlow;

        // fallback: prova a inferire dal campaign_label/campaign_key
        const byLabel = (microQuestions || []).find((q) => {
          const key = String(q?.campaign_key || "").toLowerCase();
          const label = String(q?.campaign_label || "").toLowerCase();
          return key.includes(f) || label.includes(f);
        });
        if (byLabel) return byLabel;

        return null;
      };

      // Helper: fetch export results on-demand (così non dipende dalla selezione corrente)
      const fetchMicroExport = async (questionId) => {
        const { res, data } = await fetchJsonWithFallback(
          `/api/admin-micro-polls?mode=results&question_id=${encodeURIComponent(questionId)}`,
          { method: "GET" }
        );

        if (res.status === 401) {
          throw new Error("Codice segreto non valido (micro-polls). ");
        }

        if (!res.ok || !data?.ok) {
          throw new Error(data?.error || "Errore nel caricamento risultati micro-poll");
        }

        return {
          stats: data.stats || null,
          rows: Array.isArray(data.rows) ? data.rows : [],
        };
      };

      // Export SPEAKER
      if (exportMicroSpeaker) {
        const speakerQ = findQuestionByFlow("speaker");
        const qid = String(speakerQ?.id || "");
        if (qid) {
          const { rows, stats } = await fetchMicroExport(qid);
          const csv = buildMicroPollCsv({
            question: speakerQ,
            rows,
            stats,
          });
          const qIdShort = qid.slice(0, 6);
          downloadTextFile(`vocaltworld_micro_poll_speaker_${qIdShort}_${stamp}.csv`, csv);
        }
      }

      // Export LISTENER
      if (exportMicroListener) {
        const listenerQ = findQuestionByFlow("listener");
        const qid = String(listenerQ?.id || "");
        if (qid) {
          const { rows, stats } = await fetchMicroExport(qid);
          const csv = buildMicroPollCsv({
            question: listenerQ,
            rows,
            stats,
          });
          const qIdShort = qid.slice(0, 6);
          downloadTextFile(`vocaltworld_micro_poll_listener_${qIdShort}_${stamp}.csv`, csv);
        }
      }

      setIsExportOpen(false);
    } catch (e) {
      setError(e?.message || "Errore export CSV");
      setIsExportOpen(false);
    }
  }
  const renderMicroSection = () => {
    const selectedQ = microQuestions.find((q) => String(q?.id || "") === String(microSelectedId || ""));
   const selectedBase = inferMicroFlowFromQuestion(selectedQ);
    const selectedQuestionText = (selectedQ?.question || "").toString().trim();
    const selectedShortId = String(selectedQ?.id || "").slice(0, 6);
   const selectedFullLabel = selectedQ ? getMicroQuestionLabel(selectedQ) : "";
          // Opzioni dinamiche: supporta Speaker (option_yes/option_no) e Listener (option_1..option_4)
    const opt1 = (selectedQ?.option_1 ?? selectedQ?.option_yes ?? "Sì").toString();
    const opt2 = (selectedQ?.option_2 ?? selectedQ?.option_no ?? "No").toString();
    const opt3 = (selectedQ?.option_3 ?? "").toString();
    const opt4 = (selectedQ?.option_4 ?? "").toString();

    const hasOpt3 = !!opt3.trim();
    const hasOpt4 = !!opt4.trim();
    const isFour = hasOpt3 || hasOpt4;

    // Stats: compatibile sia col vecchio formato (yes/no) sia col nuovo (c1..c4)
    const c1 = microStats?.c1 ?? microStats?.count1 ?? microStats?.yes ?? 0;
    const c2 = microStats?.c2 ?? microStats?.count2 ?? microStats?.no ?? 0;
    const c3 = microStats?.c3 ?? microStats?.count3 ?? 0;
    const c4 = microStats?.c4 ?? microStats?.count4 ?? 0;

    const p1 = microStats?.pct1 ?? microStats?.pctYes ?? 0;
    const p2 = microStats?.pct2 ?? microStats?.pctNo ?? 0;
    const p3 = microStats?.pct3 ?? 0;
    const p4 = microStats?.pct4 ?? 0;

    function choiceLabel(choice) {
      const c = normalizeMicroChoice(choice);
      if (c === "1") return opt1;
      if (c === "2") return opt2;
      if (c === "3") return opt3 || "Opzione 3";
      if (c === "4") return opt4 || "Opzione 4";
      return "-";
    }

    return (
      <section className="admin-section" style={{ marginTop: 18 }}>
        <h2 className="admin-subtitle">Micro-sondaggi (Email CTA)</h2>

        {/* FILTRO DOMANDE (fuori dalla casella) */}
        <div
          style={{
            marginTop: 10,
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          {microQuestions.length <= 1 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 320 }}>
              <div style={{ fontWeight: 700, opacity: 0.9 }}>Domanda (Email 3 — Speaker)</div>
              <div
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(0,0,0,0.35)",
                  color: "#fff",
                  maxWidth: 720,
                  lineHeight: 1.25,
                }}
              >
                {selectedFullLabel || "—"}
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 320 }}>
              <div style={{ fontWeight: 700, opacity: 0.9 }}>Seleziona domanda</div>
              <select
                value={microSelectedId}
                onChange={(e) => setMicroSelectedId(e.target.value)}
                style={{
                  padding: "10px 12px",
                  borderRadius: 12,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "rgba(0,0,0,0.35)",
                  color: "#fff",
                  outline: "none",
                  maxWidth: 720,
                }}
              >
                <option value="">-- scegli --</option>
                {microQuestions.map((q) => {
                 const label = getMicroQuestionLabel(q);
                  return (
                    <option key={q.id} value={q.id}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="admin-logout-btn"
              onClick={() => {
                fetchMicroQuestions();
                if (microSelectedId) fetchMicroResults(microSelectedId, { silent: false });
              }}
              title="Aggiorna micro-sondaggi"
            >
              Aggiorna
            </button>

            <button
              type="button"
              className="admin-logout-btn"
              onClick={() => {
                setIsMicroOpen(false);
                setView("main");
              }}
              title="Chiudi"
            >
              Chiudi
            </button>
          </div>
        </div>

        <div className="admin-detail" style={{ padding: 16, marginTop: 14 }}>
          {/* DOMANDA SELEZIONATA (mostrata dentro la casella) */}
          {selectedFullLabel ? (
            <div style={{ marginBottom: 10, fontWeight: 800, opacity: 0.92 }}>
              {selectedFullLabel}
            </div>
          ) : (
            <div style={{ marginBottom: 10, opacity: 0.75 }}>
              Seleziona una domanda dal menu qui sopra.
            </div>
          )}

          {microError && (
            <div style={{ marginTop: 10 }}>
              <p className="admin-error">Errore micro-polls: {microError}</p>
            </div>
          )}
{microSelectedId && microStats && (
  <div className="admin-stats" style={{ marginTop: 12 }}>
    <div className="admin-stat-card admin-stat-total">
      <span className="admin-stat-label">Totale voti</span>
      <span className="admin-stat-value">{microStats.total ?? 0}</span>
    </div>

    <div className="admin-stat-card admin-stat-yes">
      <span className="admin-stat-label">1 — {opt1 || "Opzione 1"}</span>
      <span className="admin-stat-value">
        {c1}
        <span className="admin-stat-sub"> ({p1}%)</span>
      </span>
    </div>

    <div className="admin-stat-card admin-stat-no">
      <span className="admin-stat-label">2 — {opt2 || "Opzione 2"}</span>
      <span className="admin-stat-value">
        {c2}
        <span className="admin-stat-sub"> ({p2}%)</span>
      </span>
    </div>

    {isFour && (
      <>
        <div className="admin-stat-card admin-stat-yes">
          <span className="admin-stat-label">3 — {opt3 || "Opzione 3"}</span>
          <span className="admin-stat-value">
            {c3}
            <span className="admin-stat-sub"> ({p3}%)</span>
          </span>
        </div>

        <div className="admin-stat-card admin-stat-no">
          <span className="admin-stat-label">4 — {opt4 || "Opzione 4"}</span>
          <span className="admin-stat-value">
            {c4}
            <span className="admin-stat-sub"> ({p4}%)</span>
          </span>
        </div>
      </>
    )}
  </div>
)}
          {microSelectedId && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                <h3 style={{ margin: 0, fontSize: 14, opacity: 0.9 }}>Risposte (live)</h3>
                <div style={{ fontSize: 12, opacity: 0.75 }}>
                  {microLoading
  ? "Sincronizzo…"
  : microLastUpdatedAt
    ? `Aggiornamento automatico • ${formatDate(microLastUpdatedAt)}`
    : "Aggiornamento automatico"}
                </div>
              </div>

              <div className="admin-table" style={{ marginTop: 10 }}>
                <div className="admin-table-header">
                  <div className="admin-th admin-th-email">Email</div>
                  <div className="admin-th admin-th-date">Data</div>
                  <div className="admin-th admin-th-score">Scelta</div>
                </div>

                <div className="admin-table-body" ref={microRowsBodyRef}>
                  {microRows.map((r, idx) => {
                    const rowKey = microRowKey(r);
                    const choice = normalizeMicroChoice(r.choice);
                    return (
                      <div key={rowKey} className="admin-row" style={{ cursor: "default" }}>
                        <div className="admin-td admin-td-email" title={r.email || ""}>
                          {displayEmail(r.email)}
                        </div>
                        <div className="admin-td admin-td-date">{formatDate(r.created_at || r.createdAt)}</div>
                        <div className="admin-td admin-td-score">
                          <span
                            className={
                              "admin-pill " +
                              (choice === "1" || choice === "3"
                                 ? "admin-pill-yes"
                                 : choice === "2" || choice === "4"
                                   ? "admin-pill-no"
                                   : "")
                                  }
                          >
                            {choiceLabel(choice)}
                          </span>
                        </div>
                      </div>
                    );
                  })}

                  {microRows.length === 0 && (
                    <div className="admin-table-empty">Nessuna risposta registrata per questa domanda.</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  };

  // Chiave stabile per ritrovare lo stesso record dopo un refresh dei dati
  const getSurveyKey = (s) => {
    const email = String(s?.email || "").toLowerCase();
    const ts =
      s?.createdAt ||
      s?.surveyCompletedAt ||
      s?.date ||
      s?.created_at ||
      s?.survey_completed_at ||
      "";
    const id = s?.id ?? s?.submission_id ?? "";
    return `${email}__${id || ts}`;
  };

  const [adminKey, setAdminKey] = useState(() => {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem("vt_admin_key") || "";
  });

  const [isAuth, setIsAuth] = useState(() => {
    if (typeof window === "undefined") return false;
    return !!window.localStorage.getItem("vt_admin_key");
  });

  const lastInfo = getLastResponseInfo(surveys);
  const answers = selectedSurvey?.answers || {};

  const validation = useMemo(() => {
    if (!stats || !stats.total) {
      return {
        level: "none",
        title: "In attesa di dati",
        subtitle: "Condividi il sondaggio per iniziare a validare Vocal T World.",
        hint: "Obiettivo minimo: almeno 30 risposte reali.",
      };
    }

    const total = stats.total;
    const pct = stats.interestedPercent || 0;

    const MIN_RESPONSES = 30;
    const STRONG_PCT = 70;
    const OK_PCT = 50;

    if (total < MIN_RESPONSES) {
      return {
        level: "low",
        title: "Dati ancora insufficienti",
        subtitle: `Hai ${total} risposte. Obiettivo minimo: ${MIN_RESPONSES}.`,
        hint: "Continua a raccogliere feedback prima di tirare conclusioni.",
      };
    }

    if (pct >= STRONG_PCT) {
      return {
        level: "good",
        title: "Idea promettente ✅",
        subtitle: `${total} risposte, ${pct}% interessati.`,
        hint: "Ha senso pensare a prototipo, lista d'attesa e piano di lancio.",
      };
    }

    if (pct >= OK_PCT) {
      return {
        level: "medium",
        title: "Da approfondire ⚠️",
        subtitle: `${total} risposte, ${pct}% interessati.`,
        hint: "L'idea piace a una parte delle persone: lavora su segmento e posizionamento.",
      };
    }

    return {
      level: "bad",
      title: "Non validata (per ora) ❌",
      subtitle: `${total} risposte, solo ${pct}% interessati.`,
      hint: "Potrebbe servire rivedere prezzo, messaggio o funzionalità chiave.",
    };
  }, [stats]);

  const detailRef = useRef(null);

  // ---------------------------
  // API helper (Netlify /api/* -> Functions)
  // - In prod vogliamo chiamare SEMPRE /api/* (redirect -> functions)
  // - Se il routing /api non è allineato, Netlify risponde con HTML (index.html)
  //   e qui facciamo fallback automatico su /.netlify/functions/*
  // ---------------------------
  function toFunctionsPath(apiPath) {
    // "/api/admin-dashboard" -> "/.netlify/functions/admin-dashboard"
    return apiPath.replace(/^\/api\//, "/.netlify/functions/");
  }

  function addCacheBust(url) {
    const u = new URL(url, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    // evita cache CDN/edge quando stiamo diagnosticando routing
    u.searchParams.set("__t", String(Date.now()));
    return u.pathname + u.search;
  }

  async function safePeekHtml(res) {
    // Se Netlify ci ha servito index.html (SPA), a volte content-type è html,
    // ma per sicurezza facciamo una peek di poche decine di caratteri.
    try {
      const clone = res.clone();
      const txt = await clone.text();
      const head = (txt || "").slice(0, 200).toLowerCase();
      return head.includes("<!doctype html") || head.includes("<html");
    } catch {
      return false;
    }
  }

  async function fetchJsonWithFallback(apiPath, { method = "GET", body, headers: extraHeaders } = {}) {
    const m = String(method || "GET").toUpperCase();

    // ⚠️ Non impostiamo Content-Type su GET: alcuni edge/proxy fanno cose strane.
    const headers = {
      Accept: "application/json",
      ...(adminKey ? { "x-admin-key": adminKey } : {}),
      ...(extraHeaders || {}),
    };

    const opts = {
      method: m,
      headers,
      cache: "no-store",
    };

    if (body !== undefined && m !== "GET") {
      opts.headers = {
        ...headers,
        "Content-Type": "application/json",
      };
      opts.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    // 1) Proviamo /api/* (con cache-bust)
    const primaryUrl = addCacheBust(apiPath);
    let res = await fetch(primaryUrl, opts);
    let ct = (res.headers.get("content-type") || "").toLowerCase();

    // Condizioni di fallback:
    // - content-type html
    // - content-type non-json (es. vuoto) ma status 200
    // - body sembra HTML (peek)
    const looksHtmlByHeader = ct.includes("text/html");
    const looksNonJsonOk = res.ok && !ct.includes("application/json");
    const looksHtmlByBody = looksHtmlByHeader || looksNonJsonOk ? await safePeekHtml(res) : false;

    if (looksHtmlByHeader || looksNonJsonOk || looksHtmlByBody) {
      const fnPath = addCacheBust(toFunctionsPath(apiPath));
      res = await fetch(fnPath, opts);
      ct = (res.headers.get("content-type") || "").toLowerCase();
    }

    // Se ancora HTML, errore chiaro
    if (ct.includes("text/html") || (res.ok && !ct.includes("application/json") && (await safePeekHtml(res)))) {
      const err = new Error(
        "Routing non allineato: ricevuto HTML invece di JSON. (Fallback già tentato su /.netlify/functions)."
      );
      err._isHtmlFallback = true;
      err._status = res.status;
      throw err;
    }

    // Parse JSON
    const data = await res.json().catch(() => ({}));
    return { res, data };
  }

  async function requestResetResponses() {
    setResetErr("");
    setResetOk("");

    // doppia sicurezza UI
    const first = window.confirm(
      "Sei DAVVERO sicuro? Questa azione elimina SOLO le RISPOSTE (sondaggio principale + micro-polls)."
    );
    if (!first) return;

    const second = window.confirm(
      "Ultima conferma: dopo questo step riceverai una mail di conferma. Procedo a inviare la mail?"
    );
    if (!second) return;

    try {
      setResetBusy(true);

      const { res, data } = await fetchJsonWithFallback("/api/admin-reset-request", {
        method: "POST",
        body: {
          admin_key: adminKey || "",
          email: RESET_CONFIRM_EMAIL,
        },
      });

      if (res.status === 401) {
        throw new Error("Codice segreto non valido.");
      }

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Errore invio email reset");
      }

      setResetOk(
        `Email inviata a ${RESET_CONFIRM_EMAIL}. Apri la mail e clicca su "Conferma reset" per svuotare le risposte.`
      );
    } catch (e) {
      setResetErr(e?.message || "Errore inatteso");
    } finally {
      setResetBusy(false);
    }
  }

  async function refreshAfterReset() {
    // dopo che hai cliccato il link nella mail
    setResetErr("");
    setResetOk("");
    try {
      setResetBusy(true);
      await fetchDashboardData({ silent: false });
      if (microSelectedId) await fetchMicroResults(microSelectedId, { silent: false });
      setResetOk("Se hai confermato via email, i dati ora dovrebbero essere vuoti ✅");
    } catch (e) {
      setResetErr(e?.message || "Errore refresh");
    } finally {
      setResetBusy(false);
    }
  }

  async function fetchMicroQuestions() {
    try {
      setMicroError("");
      setMicroLoading(true);

      const { res, data } = await fetchJsonWithFallback("/api/admin-micro-polls?mode=questions", {
        method: "GET",
      });

      if (res.status === 401) {
        setMicroError("Codice segreto non valido (micro-polls).");
        return;
      }

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Errore nel caricamento micro-polls");
      }

      const list = Array.isArray(data.questions) ? data.questions : [];

      // ✅ Mostra tutte le domande (la UI deve riflettere SEMPRE la domanda attiva reale su Supabase)
      // Ordiniamo per created_at desc così la lista è coerente.
      const sorted = [...list].sort((a, b) => {
        const da = new Date(a?.created_at || a?.createdAt || 0).getTime();
        const db = new Date(b?.created_at || b?.createdAt || 0).getTime();
        return db - da;
      });

 
      setMicroQuestions(sorted);

      // selezione: se non hai selezionato nulla, scegli la prima active (o la prima in lista)
      if (!microSelectedId) {
        const firstActive = sorted.find((q) => q?.active) || sorted[0];
        if (firstActive?.id) setMicroSelectedId(String(firstActive.id));
      }

      if (sorted.length === 0) {
        setMicroError(
          "Nessuna domanda trovata nella tabella micro_questions. Controlla Supabase (tabella micro_questions)."
        );
      }

    } catch (e) {
      setMicroError(e?.message || "Errore inatteso micro-polls");
    } finally {
      setMicroLoading(false);
    }
  }

  async function fetchMicroResults(questionId, { silent = false } = {}) {
    if (!questionId) return;

    try {
      if (!silent) {
        setMicroLoading(true);
        setMicroError("");
      }

      const { res, data } = await fetchJsonWithFallback(
        `/api/admin-micro-polls?mode=results&question_id=${encodeURIComponent(questionId)}`,
        { method: "GET" }
      );

      if (res.status === 401) {
        if (!silent) setMicroError("Codice segreto non valido (micro-polls).");
        return;
      }

      if (!res.ok || !data?.ok) {
        throw new Error(data?.error || "Errore nel caricamento risultati");
      }

            const nextStats = data.stats || null;
      const nextRows = Array.isArray(data.rows) ? data.rows : [];

      // firma per evitare setState inutili (no flicker)
     const statsSig = nextStats
  ? [
      nextStats.total ?? "",
      nextStats.yes ?? "",
      nextStats.no ?? "",
      nextStats.c1 ?? "",
      nextStats.c2 ?? "",
      nextStats.c3 ?? "",
      nextStats.c4 ?? "",
      nextStats.pctYes ?? "",
      nextStats.pctNo ?? "",
      nextStats.pct1 ?? "",
      nextStats.pct2 ?? "",
      nextStats.pct3 ?? "",
      nextStats.pct4 ?? "",
    ].join("|")
  : "nostats";

const nextSig =
  statsSig +
  "||" +
  nextRows.map((r) => `${microRowKey(r)}:${String(r?.choice ?? "")}`).join(",");

      if (nextSig === microSigRef.current) {
  // anche se i dati sono identici, aggiorniamo l’orario
  microLastUpdatedRef.current = Date.now();
  setMicroLastUpdatedAt(new Date().toISOString());
  return;
}

      const el = microRowsBodyRef.current;
      const prevScrollTop = el ? el.scrollTop : 0;
      const prevScrollHeight = el ? el.scrollHeight : 0;

      microSigRef.current = nextSig;
      setMicroStats(nextStats);
      setMicroRows(nextRows);

      microLastUpdatedRef.current = Date.now();
      setMicroLastUpdatedAt(new Date().toISOString());

      requestAnimationFrame(() => {
        const el2 = microRowsBodyRef.current;
        if (!el2) return;

        const newScrollHeight = el2.scrollHeight;
        const delta = newScrollHeight - prevScrollHeight;

        // se l’utente NON è in cima, compensiamo il delta per non spostare la vista
        const userIsNearTop = prevScrollTop < 20;
        if (!userIsNearTop && delta > 0) {
          el2.scrollTop = prevScrollTop + delta;
        } else {
          el2.scrollTop = prevScrollTop;
        }
      });
    } catch (e) {
      if (!silent) setMicroError(e?.message || "Errore inatteso risultati");
    } finally {
      if (!silent) setMicroLoading(false);
    }
  }

  async function fetchDashboardData({ silent = false } = {}) {
    // Evita richieste troppo ravvicinate (anti-thrashing)
    const now = Date.now();
    if (silent && now - lastFetchAtRef.current < 5000) return;
    lastFetchAtRef.current = now;
    try {
      if (!silent) setLoading(true);
      if (!silent) setError("");
      if (silent) setIsSyncing(true);

      // Proviamo POST (compatibilità con versioni precedenti), ma se il backend è GET-only
      // o se per qualche motivo la route non è trovata, facciamo fallback GET.
      let res;
      let data;

      try {
        ({ res, data } = await fetchJsonWithFallback("/api/admin-dashboard", {
          method: "POST",
          body: { secret: adminKey || "" },
        }));
      } catch (e) {
        // Se arriva HTML, è un problema di routing /api
        if (e?._isHtmlFallback) throw e;
        throw e;
      }

      // Fallback GET se la function è stata implementata GET-only o se Netlify risponde 404 su POST
      if (res && res.status === 404) {
        ({ res, data } = await fetchJsonWithFallback("/api/admin-dashboard", { method: "GET" }));
      }

      if (res.status === 401) {
        setError("Codice segreto non valido.");
        setIsAuth(false);
        if (typeof window !== "undefined") window.localStorage.removeItem("vt_admin_key");
        if (!silent) setLoading(false);
        return;
      }

      if (!res.ok) throw new Error("Errore nel caricamento dei dati (" + res.status + ")");

      let nextSurveys = data.surveys || data.responses || [];
      if (!Array.isArray(nextSurveys)) nextSurveys = [];

      nextSurveys = nextSurveys.map(normalizeSurvey);

      nextSurveys = [...nextSurveys].sort((a, b) => {
        const da = new Date(a.createdAt || a.surveyCompletedAt || a.date || 0).getTime();
        const db = new Date(b.createdAt || b.surveyCompletedAt || b.date || 0).getTime();
        return db - da;
      });

      // Calcolo nuovi elementi (senza impattare scroll / dettagli)
      const nextKeys = new Set(nextSurveys.map(getSurveyKey));
      const prevKeys = lastKeysRef.current;
      let added = 0;
      for (const k of nextKeys) {
        if (!prevKeys.has(k)) added += 1;
      }
      lastKeysRef.current = nextKeys;
      if (added > 0) setNewItems((x) => x + added);

      setSurveys(nextSurveys);

      // Se stavi guardando un dettaglio, mantieni la selezione e aggiorna i dati
      if (selectedKeyRef.current) {
        const found = nextSurveys.find((s) => getSurveyKey(s) === selectedKeyRef.current);
        if (found) setSelectedSurvey(found);
      }

      const total = nextSurveys.length;
      const interestedCount = nextSurveys.filter((s) => !!s.normalizedIsInterested).length;
      const notInterestedCount = total - interestedCount;

      const interestedPercent = total ? Math.round((interestedCount / total) * 100) : 0;
      const notInterestedPercent = total ? Math.round((notInterestedCount / total) * 100) : 0;

      setStats({
        total,
        interested: interestedCount,
        interestedPercent,
        notInterested: notInterestedCount,
        notInterestedPercent,
      });
    } catch (err) {
      // In modalità silent non "sporchiamo" la UI con errori
      if (!silent) setError(err?.message || "Errore inatteso");
    } finally {
      if (silent) setIsSyncing(false);
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    if (!isAuth) return;

    // primo load “normale”
    fetchDashboardData({ silent: false });
    fetchMicroQuestions();

    // polling ogni 15 secondi “silenzioso” (nessun refresh pagina)
    pollingRef.current = setInterval(() => {
      // se tab non è visibile, non sprechiamo chiamate
      if (typeof document !== "undefined" && document.hidden) return;
      fetchDashboardData({ silent: true });
    }, 15000);

    // polling leggero micro-polls (solo se c'è una domanda selezionata)
  microPollingRef.current = setInterval(() => {
  if (typeof document !== "undefined" && document.hidden) return;
  const qid = microSelectedIdRef.current;
  if (!qid) return;
  fetchMicroResults(qid, { silent: true });
}, 8000);

  const onFocus = () => {
  fetchDashboardData({ silent: true });
  const qid = microSelectedIdRef.current;
  if (qid) fetchMicroResults(qid, { silent: true });
};

const onVisibility = () => {
  if (typeof document !== "undefined" && !document.hidden) {
    fetchDashboardData({ silent: true });
    const qid = microSelectedIdRef.current;
    if (qid) fetchMicroResults(qid, { silent: true });
  }
};

    if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = null;

      if (microPollingRef.current) clearInterval(microPollingRef.current);
      microPollingRef.current = null;

      if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isAuth, adminKey, microSelectedId]);

  useEffect(() => {
    if (!isAuth) return;
    if (!microSelectedId) return;
    fetchMicroResults(microSelectedId, { silent: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [microSelectedId, isAuth]);

  const handleRowClick = (survey, rowId) => {
    setSelectedSurvey(survey);
    setLastRowId(rowId);
    selectedKeyRef.current = getSurveyKey(survey);
    // Azzeriamo il contatore nuovi se apri un dettaglio (stai “guardando” gli ultimi dati)
    setNewItems(0);

    setTimeout(() => {
      if (detailRef.current) detailRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 80);
  };

  const handleCloseDetails = () => {
    setSelectedSurvey(null);
    selectedKeyRef.current = null;

    setTimeout(() => {
      if (!lastRowId) return;
      const rowEl = document.getElementById(lastRowId);
      if (!rowEl) return;

      rowEl.scrollIntoView({ behavior: "smooth", block: "center" });
      rowEl.classList.add("admin-row-last");
      setTimeout(() => rowEl.classList.remove("admin-row-last"), 1200);
    }, 80);
  };

  const handleLogout = () => {
    if (typeof window !== "undefined") window.localStorage.removeItem("vt_admin_key");

    setAdminKey("");
    setIsAuth(false);
    setStats(null);
    setSurveys([]);
    lastKeysRef.current = new Set();
    setNewItems(0);
    setSelectedSurvey(null);
    selectedKeyRef.current = null;
    setLastRowId(null);
    setError("");
  };

  if (!isAuth) {
    return (
      <div className="admin-page admin-login-page">
        <h1 className="admin-title">Accesso dashboard</h1>
        <p>Inserisci il codice segreto amministratore.</p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!adminKey) return;
            if (typeof window !== "undefined") window.localStorage.setItem("vt_admin_key", adminKey);
            setIsAuth(true);
            setError("");
          }}
          className="admin-login-form"
        >
          <input
            type="password"
            className="admin-login-input"
            placeholder="Codice segreto"
            value={adminKey}
            onChange={(e) => setAdminKey(e.target.value)}
          />
          <button type="submit" className="admin-login-button">
            Entra
          </button>
        </form>

        {error && <p className="admin-error">Errore: {error}</p>}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="admin-page">
        <p className="admin-loading">Caricamento dashboard…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="admin-page">
        <p className="admin-error">Errore: {error}</p>
      </div>
    );
  }

  if (view === "micro") {
    return (
      <div className="admin-page">
        <div className="admin-header">
          <div className="admin-header-left">
            <h1 className="admin-title">Micro-sondaggi</h1>
            <p style={{ margin: "6px 0 0 0", opacity: 0.85 }}>Filtra per campagna e vedi le risposte in tempo reale.</p>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <button
              type="button"
              className="admin-logout-btn"
              onClick={() => {
                setView("main");
                setIsMicroOpen(false);
              }}
              style={{
                opacity: 0.95,
                background: "rgba(0, 122, 255, 0.20)",
                border: "1px solid rgba(0, 122, 255, 0.40)",
              }}
              title="Torna alla dashboard"
            >
              ← Dashboard
            </button>

            <button
              type="button"
              className="admin-logout-btn"
              onClick={() => {
                fetchMicroQuestions();
                if (microSelectedId) fetchMicroResults(microSelectedId, { silent: false });
              }}
              style={{ opacity: 0.9 }}
              title="Aggiorna micro-polls"
            >
              Aggiorna
            </button>

            <button type="button" className="admin-logout-btn" onClick={handleLogout}>
              Esci
            </button>
          </div>
        </div>

        {renderMicroSection()}
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <div className="admin-header-left">
          <h1 className="admin-title">Dashboard Vocal T World</h1>

          {lastInfo && (
            <div className={`last-badge ${lastInfo.isFresh ? "fresh" : "stale"}`}>
              <span className="last-badge-icon">⏰</span>
              <span className="last-badge-text">{lastInfo.label}</span>
              {lastInfo.isFresh ? <span className="last-badge-ok">✅</span> : <span className="last-badge-alert">‼️</span>}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <button
            type="button"
            className="admin-logout-btn"
            onClick={() => {
              setIsResetOpen(true);
              setResetErr("");
              setResetOk("");
              setResetTyped("");
            }}
            style={{
              opacity: 0.95,
              background: "rgba(239, 68, 68, 0.14)",
              border: "1px solid rgba(239, 68, 68, 0.32)",
            }}
            title="Reset risposte (solo dopo i test)"
          >
            🗑 Reset risposte
          </button>
          {(newItems > 0 || isSyncing) && (
            <div
              className={"admin-sync-badge " + (isSyncing ? "syncing" : "ready")}
              title={isSyncing ? "Sincronizzazione in corso" : "Dati aggiornati"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 999,
                fontSize: 12,
                opacity: 0.95,
              }}
            >
              <span aria-hidden="true">{isSyncing ? "⏳" : "✅"}</span>
              <span>
                {isSyncing
                  ? "Sincronizzo…"
                  : newItems > 0
                    ? `${newItems} nuovi`
                    : "Aggiornato"}
              </span>
              {newItems > 0 && !isSyncing && (
                <button
                  type="button"
                  onClick={() => {
                    setNewItems(0);
                    fetchDashboardData({ silent: true });
                  }}
                  style={{
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    fontSize: 12,
                    textDecoration: "underline",
                  }}
                >
                  aggiorna
                </button>
              )}
            </div>
          )}

          <button
            type="button"
            className="admin-logout-btn"
            onClick={() => setIsExportOpen(true)}
            style={{
              opacity: 0.95,
              background: "rgba(0, 122, 255, 0.14)",
              border: "1px solid rgba(0, 122, 255, 0.30)",
            }}
            title="Esporta CSV"
          >
            ⬇︎ Export
          </button>
          <button
            type="button"
            className="admin-logout-btn"
            onClick={() => {
              setIsMicroOpen(true);
              setView("micro");
              // al primo click, se non abbiamo ancora caricato, ricarichiamo
              if (!microQuestions || microQuestions.length === 0) fetchMicroQuestions();
            }}
            style={{
              opacity: 0.95,
              background: "rgba(0, 122, 255, 0.20)",
              border: "1px solid rgba(0, 122, 255, 0.40)",
            }}
            title="Apri micro-sondaggi"
          >
            ☰ Micro
          </button>

          <button
            type="button"
            className="admin-logout-btn"
            onClick={() => fetchDashboardData({ silent: false })}
            style={{ opacity: 0.9 }}
            title="Aggiorna dati"
          >
            Aggiorna
          </button>

          <button type="button" className="admin-logout-btn" onClick={handleLogout}>
            Esci
          </button>
        </div>
      </div>

      {isExportOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.55)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 9999,
            padding: 18,
          }}
          onClick={() => setIsExportOpen(false)}
        >
          <div
            style={{
              width: "min(620px, 96vw)",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(10, 10, 14, 0.92)",
              boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
              padding: 18,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900 }}>Export dati (CSV)</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  Seleziona cosa scaricare. I download partiranno separati (file distinti).
                </div>
              </div>

              <button type="button" className="admin-logout-btn" onClick={() => setIsExportOpen(false)}>
                Chiudi
              </button>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input type="checkbox" checked={exportMain} onChange={(e) => setExportMain(e.target.checked)} />
                <div>
                  <div style={{ fontWeight: 800 }}>Dashboard principale</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>Partecipanti + score + campi del sondaggio</div>
                </div>
              </label>

              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={exportMicroSpeaker}
                  onChange={(e) => setExportMicroSpeaker(e.target.checked)}
                />
                <div>
                  <div style={{ fontWeight: 800 }}>Micro-poll (Email 3 — Speaker)</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>SI/NO + elenco risposte (file separato)</div>
                </div>
              </label>

              <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={exportMicroListener}
                  onChange={(e) => setExportMicroListener(e.target.checked)}
                />
                <div>
                  <div style={{ fontWeight: 800 }}>Micro-poll (Email 3 — Listener)</div>
                  <div style={{ fontSize: 12, opacity: 0.75 }}>4 opzioni + elenco risposte (file separato)</div>
                </div>
              </label>

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
                <button
                  type="button"
                  className="admin-logout-btn"
                  onClick={() => {
                    setExportMain(true);
                    setExportMicroSpeaker(true);
                    setExportMicroListener(true);
                  }}
                  style={{ opacity: 0.9 }}
                >
                  Seleziona tutto
                </button>

                <button
                  type="button"
                  className="admin-logout-btn"
                  onClick={doExport}
                  disabled={!exportMain && !exportMicroSpeaker && !exportMicroListener}
                  style={{
                    opacity: !exportMain && !exportMicroSpeaker && !exportMicroListener ? 0.5 : 1,
                    background: "rgba(34, 197, 94, 0.18)",
                    border: "1px solid rgba(34, 197, 94, 0.35)",
                  }}
                >
                  Scarica
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isResetOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.62)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10000,
            padding: 18,
          }}
          onClick={() => setIsResetOpen(false)}
        >
          <div
            style={{
              width: "min(640px, 96vw)",
              borderRadius: 18,
              border: "1px solid rgba(255,255,255,0.14)",
              background: "rgba(10, 10, 14, 0.92)",
              boxShadow: "0 20px 80px rgba(0,0,0,0.55)",
              padding: 18,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 900 }}>Reset risposte (2 step)</div>
                <div style={{ fontSize: 12, opacity: 0.75, marginTop: 4 }}>
                  Elimina <strong>solo le risposte</strong> (sondaggio principale + micro-polls). Non tocca log/token.
                </div>
              </div>

              <button type="button" className="admin-logout-btn" onClick={() => setIsResetOpen(false)}>
                Chiudi
              </button>
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 10 }}>
              <div
                style={{
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(255,255,255,0.12)",
                  background: "rgba(0,0,0,0.35)",
                }}
              >
                <div style={{ fontWeight: 800 }}>Sicurezza</div>
                <div style={{ fontSize: 12, opacity: 0.8, marginTop: 6, lineHeight: 1.5 }}>
                  1) Conferma UI (2 popup) • 2) Ti mando una mail a <strong>{RESET_CONFIRM_EMAIL}</strong>.
                  Il reset parte <strong>solo</strong> dopo che clicchi “Conferma reset” nella mail.
                </div>
              </div>

              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, opacity: 0.85 }}>
                  Scrivi <strong>RESET</strong> qui sotto (anti-click accidentale)
                </div>
                <input
                  value={resetTyped}
                  onChange={(e) => setResetTyped(e.target.value)}
                  placeholder="RESET"
                  style={{
                    padding: "10px 12px",
                    borderRadius: 12,
                    border: "1px solid rgba(255,255,255,0.14)",
                    background: "rgba(0,0,0,0.35)",
                    color: "#fff",
                    outline: "none",
                  }}
                />
              </label>

              {(resetErr || resetOk) && (
                <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {resetErr && <div style={{ color: "#ff7b7b" }}>Errore: {resetErr}</div>}
                  {resetOk && <div style={{ color: "rgba(255,255,255,0.88)" }}>{resetOk}</div>}
                </div>
              )}

              <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 6 }}>
                <button
                  type="button"
                  className="admin-logout-btn"
                  onClick={refreshAfterReset}
                  disabled={resetBusy}
                  style={{ opacity: resetBusy ? 0.6 : 1 }}
                  title="Dopo aver cliccato il link di conferma nella mail, aggiorna i dati"
                >
                  ↻ Ho confermato via email
                </button>

                <button
                  type="button"
                  className="admin-logout-btn"
                  onClick={requestResetResponses}
                  disabled={resetBusy || String(resetTyped).trim().toUpperCase() !== "RESET"}
                  style={{
                    opacity:
                      resetBusy || String(resetTyped).trim().toUpperCase() !== "RESET" ? 0.5 : 1,
                    background: "rgba(239, 68, 68, 0.18)",
                    border: "1px solid rgba(239, 68, 68, 0.38)",
                  }}
                >
                  {resetBusy ? "Invio…" : "Invia email di reset"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {validation && (
        <section className={`validation-card validation-${validation.level}`}>
          <div className="validation-main">
            <h2 className="validation-title">{validation.title}</h2>
            <p className="validation-subtitle">{validation.subtitle}</p>
          </div>
          <p className="validation-hint">{validation.hint}</p>
        </section>
      )}

      {stats && (
        <div className="admin-stats">
          <div className="admin-stat-card admin-stat-total">
            <span className="admin-stat-label">Partecipanti totali</span>
            <span className="admin-stat-value">{stats.total}</span>
          </div>

          <div className="admin-stat-card admin-stat-yes">
            <span className="admin-stat-label">Interessati</span>
            <span className="admin-stat-value">
              {stats.interested}
              <span className="admin-stat-sub"> ({stats.interestedPercent}%)</span>
            </span>
          </div>

          <div className="admin-stat-card admin-stat-no">
            <span className="admin-stat-label">Non interessati</span>
            <span className="admin-stat-value">
              {stats.notInterested}
              <span className="admin-stat-sub"> ({stats.notInterestedPercent}%)</span>
            </span>
          </div>
        </div>
      )}

      {isMicroOpen && renderMicroSection()}

      <section className="admin-section">
        <h2 className="admin-subtitle">Elenco partecipanti</h2>

        <div className="admin-table">
          <div className="admin-table-header">
            <div className="admin-th admin-th-email">Email</div>
            <div className="admin-th admin-th-date">Data</div>
            <div className="admin-th admin-th-score">Score</div>
            <div className="admin-th admin-th-int">Interessato?</div>
          </div>

            <div className="admin-table-body" ref={surveysTableBodyRef}>
              {surveys.map((s, index) => {
                const rowId = `admin-row-${index}`;
                const showScore = typeof s.normalizedInterestScore === "number" ? s.normalizedInterestScore : "-";
                const isInterested = !!s.normalizedIsInterested;

                return (
                  <button
                    key={rowId}
                    id={rowId}
                    type="button"
                    className="admin-row"
                    onClick={() => handleRowClick(s, rowId)}
                  >
                <div className="admin-td admin-td-email" title={s.email}>
  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <div>{displayEmail(s.email)}</div>

    <span
      className={
        "admin-badge " +
        ((s.isEmailSubscribed || s.email_subscribed || s.emailSubscribed)
          ? "admin-badge-subscribed"
          : "admin-badge-survey")
      }
    >
      {(s.isEmailSubscribed || s.email_subscribed || s.emailSubscribed)
        ? "Sondaggio + iscrizione"
        : "Solo sondaggio"}
    </span>
  </div>
</div>

                  <div className="admin-td admin-td-date">
                    {formatDate(s.createdAt || s.surveyCompletedAt || s.date)}
                  </div>

                  <div className="admin-td admin-td-score">{showScore}</div>

                  <div className="admin-td admin-td-int">
                    <span className={"admin-pill " + (isInterested ? "admin-pill-yes" : "admin-pill-no")}>
                      {isInterested ? "SI" : "NO"}
                    </span>
                  </div>
                </button>
              );
            })}

            {surveys.length === 0 && <div className="admin-table-empty">Nessun partecipante registrato.</div>}
          </div>
        </div>
      </section>

      <section className="admin-section" ref={detailRef}>
        {selectedSurvey && (
          <div className="admin-detail">
            <div className="admin-detail-header">
              <h2>Dettaglio risposte</h2>
              <button type="button" className="admin-detail-close" onClick={handleCloseDetails}>
                Chiudi
              </button>
            </div>

            <p className="admin-detail-meta">
              <strong>Email:</strong> {displayEmail(selectedSurvey.email)}
              <br />
              <strong>Data compilazione:</strong> {formatDate(selectedSurvey.createdAt || selectedSurvey.surveyCompletedAt || selectedSurvey.date)}
            </p>

            <div className="admin-detail-grid">
              <div className="admin-detail-card">
                <div className="admin-detail-label">Uso principale</div>
                <div className="admin-detail-value">{selectedSurvey.mainUseCase || answers.mainUseCase || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Quanto spesso ti capita di avere bisogno di tradurre?</div>
                <div className="admin-detail-value">{selectedSurvey.usageFrequency || answers.usageFrequency || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Quanto ti interesserebbe un traduttore vocale offline?</div>
                <div className="admin-detail-value">{selectedSurvey.offlineInterest || answers.offlineInterest || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Fascia di prezzo che consideri ok</div>
                <div className="admin-detail-value">{selectedSurvey.priceRange || answers.priceRange || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Score interesse (algoritmo)</div>
                <div className="admin-detail-value">
                  {typeof selectedSurvey.normalizedInterestScore === "number" ? selectedSurvey.normalizedInterestScore : "-"}
                </div>

                <div className="admin-detail-subnote" style={{ marginTop: 6, opacity: 0.85, fontSize: 12 }}>
                  <div>
                    <strong>Raw score:</strong> {typeof selectedSurvey._rawScore === "number" ? selectedSurvey._rawScore : "-"}
                  </div>
                  <div>
                    <strong>Raw interestScore:</strong>{" "}
                    {typeof selectedSurvey._rawInterestScore === "number" ? selectedSurvey._rawInterestScore : "-"}
                  </div>
                </div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Profilo calcolato</div>
                <div className="admin-detail-value">{selectedSurvey.normalizedIsInterested ? "Interessato" : "Non interessato"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Hai difficoltà a comunicare in lingua straniera?</div>
                <div className="admin-detail-value">{selectedSurvey.communicationDifficulty || answers.communicationDifficulty || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Soluzione che usi oggi per tradurre</div>
                <div className="admin-detail-value">{selectedSurvey.currentSolution || answers.currentSolution || "-"}</div>
              </div>

              <div className="admin-detail-card">
                <div className="admin-detail-label">Interesse immediato per traduttore offline</div>
                <div className="admin-detail-value">{selectedSurvey.instantOfflineInterest || answers.instantOfflineInterest || "-"}</div>
              </div>

              {(selectedSurvey.extraNote || answers.extraNote) && (
                <div className="admin-detail-card admin-detail-card-wide">
                  <div className="admin-detail-label">Note aggiuntive</div>
                  <div className="admin-detail-value">{selectedSurvey.extraNote || answers.extraNote}</div>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}