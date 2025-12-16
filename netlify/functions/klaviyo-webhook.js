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

    // ✅ Parse body early (serve anche per prendere il secret da body se Klaviyo non passa header)
    let payload = {};
    try {
      payload = event.body ? JSON.parse(event.body) : {};
    } catch {
      payload = {};
    }

    // ✅ Accetta più nomi header (Klaviyo UI a volte tronca/varia)
    const headerProvided = (
      getHeader(event.headers, "x-webhook-secret") ||
      getHeader(event.headers, "x-klaviyo-webhook-secret") ||
      getHeader(event.headers, "klaviyo-webhook-secret") ||
      getHeader(event.headers, "klaviyo_webhook_secret") ||
      getHeader(event.headers, "klaviyo-webhook-sec") ||
      getHeader(event.headers, "klaviyo_webhook_sec") ||
      getHeader(event.headers, "klaviyo_webhook_secret") ||
      getHeader(event.headers, "klaviyo_webhook_sec")
    ).trim();

    // ✅ Fallback: secret nel body (utile per test manuali o se Klaviyo non supporta header custom)
    const bodyProvided = String(
      payload?.secret || payload?.webhook_secret || payload?.webhookSecret || ""
    ).trim();

    const provided = (headerProvided || bodyProvided).trim();

    if (!WEBHOOK_SECRET || !provided || provided !== WEBHOOK_SECRET) {
      return json(401, { ok: false, error: "Unauthorized" });
    }

    // ✅ Klaviyo può mandare email in vari path
    const rawEmail =
      payload?.email ||
      payload?.data?.email ||
      payload?.person?.email ||
      payload?.profile?.email ||
      payload?.data?.person?.email ||
      payload?.data?.profile?.email ||
      payload?.data?.attributes?.email ||
      payload?.data?.profile?.attributes?.email ||
      "";

    const email = String(rawEmail || "").trim().toLowerCase();
    if (!email) return json(400, { ok: false, error: "Missing email" });

    // ✅ aggiorna SOLO l’ultimo record di quell’email (quello più recente)
    // Nota: PostgREST non ha "limit 1 update" diretto.
    // Facciamo 2 step: 1) prendo l’ultimo id  2) update by id
    const listEndpoint =
      `${SUPABASE_URL}/rest/v1/${SUPABASE_TABLE}` +
      `?select=id&email=ilike.${encodeURIComponent(email)}` +
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