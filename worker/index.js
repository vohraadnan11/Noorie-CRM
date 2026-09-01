// Noorie CRM — single Worker entry point.
// Handles /api/* routes directly, and serves everything else from the
// static assets bound via wrangler.toml's `assets` config.

async function handleGetCustomer(request, env) {
  const url = new URL(request.url);
  const phone = (url.searchParams.get("phone") || "").trim();

  if (!phone) {
    return Response.json({ error: "phone is required" }, { status: 400 });
  }

  const customer = await env.DB.prepare(
    "SELECT phone, name FROM customers WHERE phone = ?"
  ).bind(phone).first();

  if (!customer) {
    return Response.json({ phone, name: null, history: [], isNew: true });
  }

  const { results: history } = await env.DB.prepare(
    "SELECT amount, date FROM purchases WHERE phone = ? ORDER BY date ASC"
  ).bind(phone).all();

  return Response.json({
    phone,
    name: customer.name,
    history,
    isNew: false
  });
}

async function handlePostPurchase(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
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
    if (!name) {
      return Response.json({ error: "name is required for a new customer" }, { status: 400 });
    }
    await env.DB.prepare(
      "INSERT INTO customers (phone, name) VALUES (?, ?)"
    ).bind(phone, name).run();
  }

  await env.DB.prepare(
    "INSERT INTO purchases (phone, amount) VALUES (?, ?)"
  ).bind(phone, amount).run();

  const finalName = existing ? existing.name : name;
  const { results: history } = await env.DB.prepare(
    "SELECT amount, date FROM purchases WHERE phone = ? ORDER BY date ASC"
  ).bind(phone).all();

  return Response.json({ phone, name: finalName, history });
}

// ---- Simple PIN gate ----
// Stores no session server-side: the cookie holds a hash of the PIN itself,
// which we can recompute and compare on every request.

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
  if (!env.SITE_PIN) return true; // no PIN configured yet — don't lock owner out
  const cookie = getCookie(request, "noorie_auth");
  if (!cookie) return false;
  const expected = await sha256Hex(env.SITE_PIN);
  return cookie === expected;
}

function loginPage(error) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Noorie CRM — Sign in</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    background:#1F3A34;font-family:'Segoe UI',Arial,sans-serif;}
  .box{background:#F6F2E9;border-radius:10px;padding:32px 28px;width:280px;
    box-shadow:0 18px 40px rgba(0,0,0,0.28);text-align:center;}
  .box h1{font-size:18px;margin:0 0 4px;color:#2B2620;}
  .box p{font-size:12px;color:#6B6455;margin:0 0 18px;}
  input{width:100%;box-sizing:border-box;padding:12px;font-size:16px;text-align:center;
    letter-spacing:4px;border-radius:8px;border:1px solid #DCD4C0;margin-bottom:12px;}
  button{width:100%;padding:12px;font-size:14px;font-weight:600;border:none;border-radius:8px;
    background:#1F3A34;color:#F6F2E9;cursor:pointer;}
  .err{color:#B4543A;font-size:12px;margin:-6px 0 12px;}
</style></head>
<body>
  <form class="box" method="POST" action="/login">
    <h1>Noorie CRM</h1>
    <p>Enter PIN to continue</p>
    ${error ? '<div class="err">Incorrect PIN — try again.</div>' : ''}
    <input type="password" name="pin" inputmode="numeric" autofocus required />
    <button type="submit">Unlock</button>
  </form>
</body></html>`;
}

async function handleLogin(request, env) {
  const form = await request.formData();
  const pin = (form.get("pin") || "").toString();

  if (!env.SITE_PIN || pin !== env.SITE_PIN) {
    return new Response(loginPage(true), {
      status: 401,
      headers: { "Content-Type": "text/html" }
    });
  }

  const token = await sha256Hex(env.SITE_PIN);
  return new Response(null, {
    status: 302,
    headers: {
      "Location": "/",
      "Set-Cookie": `noorie_auth=${token}; Max-Age=${SESSION_MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`
    }
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/login" && request.method === "GET") {
      return new Response(loginPage(false), { headers: { "Content-Type": "text/html" } });
    }
    if (url.pathname === "/login" && request.method === "POST") {
      return await handleLogin(request, env);
    }

    const authed = await isAuthed(request, env);
    if (!authed) {
      if (url.pathname.startsWith("/api/")) {
        return Response.json({ error: "unauthorized" }, { status: 401 });
      }
      return Response.redirect(url.origin + "/login", 302);
    }

    try {
      if (url.pathname === "/api/customer" && request.method === "GET") {
        return await handleGetCustomer(request, env);
      }
      if (url.pathname === "/api/purchase" && request.method === "POST") {
        return await handlePostPurchase(request, env);
      }
    } catch (err) {
      return Response.json({ error: "server error", detail: String(err) }, { status: 500 });
    }

    // Everything else: serve the static app (index.html, etc.)
    return env.ASSETS.fetch(request);
  }
};
