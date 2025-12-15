function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getHeader(headers, name) {
  if (!headers) return "";
  const key = Object.keys(headers).find(
    (k) => k.toLowerCase() === name.toLowerCase()
  );
  return key ? String(headers[key] || "") : "";
}

exports.handler = async (event) => {
  try {
    // stessa auth della dashboard (se ce l'hai già)
    const ADMIN_KEY = String(
      process.env.ADMIN_KEY || process.env.ADMIN_DASHBOARD_KEY || ""
    ).trim();

    const headerKey = getHeader(event.headers, "x-admin-key").trim();
    let bodyKey = "";
    try {
      const parsed = event.body ? JSON.parse(event.body) : {};
      bodyKey = String(parsed?.secret || "").trim();
    } catch {}
    const provided = headerKey || bodyKey;

    if (ADMIN_KEY && provided !== ADMIN_KEY) {
      return json(401, { ok: false, error: "Unauthorized" });
    }

    const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
    const SERVICE_KEY = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();

    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json(500, {
        ok: false,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        hasUrl: !!SUPABASE_URL,
        hasServiceKey: !!SERVICE_KEY,
      });
    }

    // ping reale: prova a leggere 1 riga dalla tabella
    const endpoint = `${SUPABASE_URL}/rest/v1/survey_submissions?select=id&limit=1`;

    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    if (!res.ok) {
      return json(res.status, {
        ok: false,
        error: "Supabase request failed",
        status: res.status,
        endpoint,
        response: parsed,
      });
    }

    return json(200, {
      ok: true,
      message: "Supabase reachable + key valid",
      endpoint,
      sample: parsed, // di solito [] oppure [{id:...}]
    });
  } catch (err) {
    return json(500, { ok: false, error: "Internal error", message: err?.message || String(err) });
  }
};