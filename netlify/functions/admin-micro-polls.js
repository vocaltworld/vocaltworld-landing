exports.handler = async function handler(event) {
  const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
  const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

  // Reuse the same admin secret used by the dashboard (try multiple env names to be resilient)
  const ADMIN_SECRET = String(
    process.env.VT_ADMIN_KEY ||
      process.env.ADMIN_DASHBOARD_KEY ||
      process.env.ADMIN_KEY ||
      process.env.ADMIN_SECRET ||
      ""
  ).trim();

  const origin = event?.headers?.origin || event?.headers?.Origin || "";

  // Preflight
  if (event.httpMethod === "OPTIONS") {
    // 204 = no content (clean preflight)
    return json(204, undefined, origin);
  }

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json(500, { ok: false, error: "missing_env" }, origin);
  }

  // Auth: require x-admin-key to match ADMIN_SECRET
  // (same header name you already use from the client for admin-dashboard)
  const reqAdminKey = String(
    event?.headers?.["x-admin-key"] || event?.headers?.["X-Admin-Key"] || ""
  ).trim();

  if (!ADMIN_SECRET) {
    // Safer default: do NOT expose data if secret isn't configured
    return json(500, { ok: false, error: "missing_admin_secret" }, origin);
  }

  if (!reqAdminKey || reqAdminKey !== ADMIN_SECRET) {
    return json(401, { ok: false, error: "unauthorized" }, origin);
  }

  // Support both GET (query params) and POST (JSON body)
  const qs = event.queryStringParameters || {};
  const body = event.httpMethod === "POST" ? safeJson(event.body) : null;

  const mode = String(body?.mode ?? qs?.mode ?? "")
    .toLowerCase()
    .trim();

  const questionId = String(
    body?.question_id ?? body?.questionId ?? qs?.question_id ?? qs?.questionId ?? ""
  ).trim();

  try {
    if (mode === "questions") {
      // Carichiamo TUTTE le domande da una o due tabelle, ma normalizziamo in modo robusto.
      // Obiettivo:
      // - non "forzare" speaker/listener a caso
      // - riconoscere automaticamente le domande multi-opzione (1..4)
      // - mantenere compatibilità con le domande SI/NO esistenti

      // 1) Tabella principale (storica)
      const { data: baseData, error: baseErr } = await sbGet(
        `${SUPABASE_URL}/rest/v1/micro_questions?select=*&order=created_at.desc`,
        SERVICE_KEY
      );
      if (baseErr) throw baseErr;

      // 2) Tabella opzionale (se esiste ancora). Se NON esiste, non deve rompere tutto.
      let multiData = [];
      {
        const { data, error } = await sbGet(
          `${SUPABASE_URL}/rest/v1/micro_questions_multi?select=*&order=created_at.desc`,
          SERVICE_KEY
        );

        // Se la tabella non esiste (404) o non è accessibile, la ignoriamo.
        if (!error) multiData = Array.isArray(data) ? data : [];
      }

      const baseQs = Array.isArray(baseData) ? baseData : [];
      const multiQs = Array.isArray(multiData) ? multiData : [];

      const parseOptions = (q) => {
        // Priorità: options (array / json) -> option_1..4 -> yes/no
        // options può essere:
        // - text[] di Postgres (arr)
        // - JSON array serializzato (string)
        let opts = [];

        if (Array.isArray(q?.options)) {
          opts = q.options;
        } else if (typeof q?.options === "string" && q.options.trim()) {
          try {
            const parsed = JSON.parse(q.options);
            if (Array.isArray(parsed)) opts = parsed;
          } catch {
            // ignore
          }
        }

        const o1 = (q?.option_1 ?? "").toString().trim();
        const o2 = (q?.option_2 ?? "").toString().trim();
        const o3 = (q?.option_3 ?? "").toString().trim();
        const o4 = (q?.option_4 ?? "").toString().trim();

        if (!opts.length && (o1 || o2 || o3 || o4)) {
          opts = [o1, o2, o3, o4].filter((x) => x && x.trim() !== "");
        }

        // fallback SI/NO
        if (!opts.length) {
          const yes = (q?.option_yes ?? "Sì").toString().trim() || "Sì";
          const no = (q?.option_no ?? "No").toString().trim() || "No";
          opts = [yes, no];
        }

        // garantiamo max 4
        return opts.slice(0, 4).map((x) => String(x));
      };

      const inferMode = (opts) => {
        // se ci sono 3 o 4 opzioni => multi, altrimenti yn
        return opts.length >= 3 ? "multi" : "yn";
      };

      const normalizeQuestion = (q, source) => {
        const opts = parseOptions(q);
        const mode = inferMode(opts);

        // ⚠️ Qui è il fix del tuo problema:
        // - NON forziamo "speaker" se è una domanda multi
        // - se campaign_key/flow è presente lo rispettiamo
        const campaign = (q?.campaign_key || q?.campaign_label || q?.flow || "").toString().trim();
        const campaign_key = campaign
          ? campaign
          : mode === "multi"
          ? "listener"
          : "speaker";

        return {
          ...q,
          label: q?.question || q?.id,

          // campagna/flow
          campaign_key,

          // modalità UI
          mode,

          // opzioni normalizzate (sempre disponibili)
          option_1: opts[0] ?? "",
          option_2: opts[1] ?? "",
          option_3: opts[2] ?? "",
          option_4: opts[3] ?? "",

          _source: source,
        };
      };

      // Normalizziamo entrambe le fonti
      const normalizedBase = baseQs.map((q) => normalizeQuestion(q, "micro_questions"));
      const normalizedMulti = multiQs.map((q) => normalizeQuestion(q, "micro_questions_multi"));

      // Unione (evita duplicati per id se la stessa domanda fosse in due tabelle)
      const seen = new Set();
      const questions = [];
      for (const q of [...normalizedBase, ...normalizedMulti]) {
        const id = String(q?.id || "");
        if (!id) continue;
        if (seen.has(id)) continue;
        seen.add(id);
        questions.push(q);
      }

      return json(200, { ok: true, questions }, origin);
    }

    if (mode === "results") {
      if (!questionId) return json(400, { ok: false, error: "missing_question_id" }, origin);

      const { data: rows, error: rErr } = await sbGet(
        `${SUPABASE_URL}/rest/v1/micro_poll_responses?select=created_at,choice,email,voter_hash,question_id,flow,token_id&question_id=eq.${encodeURIComponent(
          questionId
        )}&order=created_at.desc&limit=500`,
        SERVICE_KEY
      );
      if (rErr) throw rErr;

      const safeRows = Array.isArray(rows) ? rows : [];

      // ✅ Multi-choice support: accepts "1".."4" + legacy "yes"/"no"
      const normChoice = (v) => {
        const c = String(v ?? "").trim().toLowerCase();
        if (c === "yes" || c === "y" || c === "si") return "1";
        if (c === "no" || c === "n") return "2";
        if (c === "1" || c === "2" || c === "3" || c === "4") return c;
        return "";
      };

      const counts = { "1": 0, "2": 0, "3": 0, "4": 0 };
      for (const r of safeRows) {
        const c = normChoice(r?.choice);
        if (c && counts[c] !== undefined) counts[c] += 1;
      }

      const total = counts["1"] + counts["2"] + counts["3"] + counts["4"];

      // Back-compat fields (Speaker poll uses 1/2)
      const yes = counts["1"];
      const no = counts["2"];

      const pct = (n) => (total ? Math.round((n / total) * 100) : 0);
      const pctYes = pct(yes);
      const pctNo = pct(no);
      const pct3 = pct(counts["3"]);
      const pct4 = pct(counts["4"]);

      return json(
        200,
        {
          ok: true,
          question_id: questionId,
          rows: safeRows,
          stats: {
            // ✅ existing fields (do not break current UI)
            yes,
            no,
            total,
            pctYes,
            pctNo,

            // ✅ new fields for Listener (multi options)
            c1: counts["1"],
            c2: counts["2"],
            c3: counts["3"],
            c4: counts["4"],
            pct1: pctYes,
            pct2: pctNo,
            pct3,
            pct4,
          },
        },
        origin
      );
    }

    return json(400, { ok: false, error: "invalid_mode" }, origin);
  } catch (e) {
    return json(500, { ok: false, error: "internal", message: String(e?.message || e || "unknown") }, origin);
  }
};

function safeJson(body) {
  if (!body) return null;
  try {
    return typeof body === "string" ? JSON.parse(body) : body;
  } catch {
    return null;
  }
}

function json(statusCode, body, origin = "") {
  // Keep permissive CORS for now, but echo origin if present
  const allowOrigin = origin || "*";

  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": allowOrigin,
    "Vary": "Origin",
    "Access-Control-Allow-Headers": "Content-Type, x-admin-key",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  // For 204 we must not send a body
  if (statusCode === 204) {
    return { statusCode, headers, body: "" };
  }

  return {
    statusCode,
    headers,
    body: body === undefined ? "" : JSON.stringify(body),
  };
}

async function sbGet(url, serviceKey) {
  const res = await fetch(url, {
    method: "GET",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return { data: null, error: { status: res.status, data } };
  }
  return { data, error: null };
}