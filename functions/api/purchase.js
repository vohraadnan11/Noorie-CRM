// POST /api/purchase
// Body: { phone, amount, name }  (name required only for new customers)
// Returns updated { name, phone, history, points }

const POINTS_PER_100 = 1;

function calcPoints(history) {
  const total = history.reduce((sum, p) => sum + p.amount, 0);
  return Math.floor(total / 100) * POINTS_PER_100;
}

export async function onRequestPost(context) {
  const { request, env } = context;
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

  return Response.json({
    phone,
    name: finalName,
    history,
    points: calcPoints(history)
  });
}
