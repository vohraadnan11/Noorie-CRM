// Noorie CRM — single Worker entry point.
// Handles /api/* routes directly, and serves everything else from the
// static assets bound via wrangler.toml's `assets` config.

const POINTS_PER_100 = 1;

function calcPoints(history) {
  const total = history.reduce((sum, p) => sum + p.amount, 0);
  return Math.floor(total / 100) * POINTS_PER_100;
}

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
    return Response.json({ phone, name: null, history: [], points: 0, isNew: true });
  }

  const { results: history } = await env.DB.prepare(
    "SELECT amount, date FROM purchases WHERE phone = ? ORDER BY date ASC"
  ).bind(phone).all();

  return Response.json({
    phone,
    name: customer.name,
    history,
    points: calcPoints(history),
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

  return Response.json({ phone, name: finalName, history, points: calcPoints(history) });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
