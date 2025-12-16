const SUPABASE_TABLE = "survey_submissions";

function json(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body),
  };
}

function getHeader(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
  return key ? String(headers[key] || "") : "";
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") return json(405, { ok: false, error: "Method not allowed" });

    // ✅ secret anti-abuso (mettila su Netlify env)
    const WEBHOOK_SECRET = String(process.env.KLAVIYO_WEBHOOK_SECRET || "").trim();
    const provided = getHeader(event.headers, "x-webhook-secret").trim();

    if (!WEBHOOK_SECRET || provided !== WEBHOOK_SECRET) {
      return json(401, { ok: false, error: "Unauthorized" });
    }

    const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
    const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const payload = event.body ? JSON.parse(event.body) : {};
    const email = String(payload.email || payload?.data?.email || "").trim().toLowerCase();
    if (!email) return json(400, { ok: false, error: "Missing email" });

    // ✅ aggiorna SOLO l’ultimo record di quell’email (quello più recente)
    // Nota: PostgREST non ha "limit 1 update" diretto.
    // Facciamo 2 step: 1) prendo l’ultimo id  2) update by id
    const listEndpoint =
      `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}` +
      `?select=id&email=eq.${encodeURIComponent(email)}` +
      `&order=created_at.desc&limit=1`;

    const listRes = await fetch(listEndpoint, {
      method: "GET",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
    });

    const rows = await listRes.json();
    const rowId = Array.isArray(rows) && rows[0]?.id ? rows[0].id : null;
    if (!rowId) return json(200, { ok: true, updated: false, reason: "No submission found for email" });

    const updEndpoint = `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}?id=eq.${rowId}`;

    const updRes = await fetch(updEndpoint, {
      method: "PATCH",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({
        email_subscribed: true,
        email_subscribed_at: new Date().toISOString(),
      }),
    });

    const updData = await updRes.json().catch(() => null);

    if (!updRes.ok) {
      return json(updRes.status, { ok: false, error: "Supabase error", status: updRes.status, data: updData });
    }

    return json(200, { ok: true, updated: true, id: rowId });
  } catch (err) {
    return json(500, { ok: false, error: "Internal error", message: err?.message || String(err) });
  }
};