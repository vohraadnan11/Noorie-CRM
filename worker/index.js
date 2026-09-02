// Noorie CRM — Worker entry point.
// Auth model: PIN gate is handled as a JS overlay in the frontend (same
// style as bill.noorie.in). The Worker serves all static assets freely,
// but protects /api/* routes with a cookie check so direct API access
// is still secured. The /api/auth endpoint lets the frontend exchange
// a PIN for a session cookie without ever needing a /login redirect.

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
}

function getCookie(request, name) {
  const header = request.headers.get("Cookie") || "";
  const match = header.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return match ? match[1] : null;
}

const SESSION_MAX_AGE = 60 * 60 * 24; // 24 hours

async function isAuthed(request, env) {
  if (!env.SITE_PIN) return true;
  const cookie = getCookie(request, "noorie_auth");
  if (!cookie) return false;
  const expected = await sha256Hex(env.SITE_PIN);
  return cookie === expected;
}

// POST /api/auth  body: { pin }
// Called by the frontend overlay — verifies PIN and sets the session cookie.
async function handleAuth(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const pin = (body.pin || "").toString();
  if (!env.SITE_PIN || pin !== env.SITE_PIN) {
    return Response.json({ error: "incorrect PIN" }, { status: 401 });
  }
  const token = await sha256Hex(env.SITE_PIN);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": `noorie_auth=${token}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`
    }
  });
}

async function handleGetCustomer(request, env) {
  const url = new URL(request.url);
  const phone = (url.searchParams.get("phone") || "").trim();
  if (!phone) return Response.json({ error: "phone is required" }, { status: 400 });

  const customer = await env.DB.prepare(
    "SELECT phone, name FROM customers WHERE phone = ?"
  ).bind(phone).first();

  if (!customer) return Response.json({ phone, name: null, history: [], isNew: true });

  const { results: history } = await env.DB.prepare(
    "SELECT amount, date FROM purchases WHERE phone = ? ORDER BY date ASC"
  ).bind(phone).all();

  return Response.json({ phone, name: customer.name, history, isNew: false });
}

async function handlePostPurchase(request, env) {
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const phone = (body.phone || "").trim();
  const amount = Number(body.amount);
  const name = (body.name || "").trim();

  if (!phone || !amount || amount <= 0) {
    return Response.json({ error: "phone and a positive amount are required" }, { status: 400 });
  }

  const existing = await env.DB.prepare(
    "SELECT phone, name FROM customers WHERE phone = ?"
  ).bind(phone).first();

  if (!existing) {
    if (!name) return Response.json({ error: "name is required for a new customer" }, { status: 400 });
    await env.DB.prepare("INSERT INTO customers (phone, name) VALUES (?, ?)").bind(phone, name).run();
  }

  await env.DB.prepare("INSERT INTO purchases (phone, amount) VALUES (?, ?)").bind(phone, amount).run();

  const finalName = existing ? existing.name : name;
  const { results: history } = await env.DB.prepare(
    "SELECT amount, date FROM purchases WHERE phone = ? ORDER BY date ASC"
  ).bind(phone).all();

  return Response.json({ phone, name: finalName, history });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Auth exchange — always accessible (it's how you get in)
    if (url.pathname === "/api/auth" && request.method === "POST") {
      return await handleAuth(request, env);
    }

    // All other /api/* routes require a valid session cookie
    if (url.pathname.startsWith("/api/")) {
      const authed = await isAuthed(request, env);
      if (!authed) return Response.json({ error: "unauthorized" }, { status: 401 });

      try {
        if (url.pathname === "/api/customer" && request.method === "GET") return await handleGetCustomer(request, env);
        if (url.pathname === "/api/purchase" && request.method === "POST") return await handlePostPurchase(request, env);
      } catch (err) {
        return Response.json({ error: "server error", detail: String(err) }, { status: 500 });
      }
    }

    // Everything else: serve static assets freely (PIN gate is in the frontend JS)
    return env.ASSETS.fetch(request);
  }
};
