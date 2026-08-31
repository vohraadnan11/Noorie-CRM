// GET /api/customer?phone=9876543210
// Returns: { name, phone, history: [{amount, date}], points, isNew }

const POINTS_PER_100 = 1;

function calcPoints(history) {
  const total = history.reduce((sum, p) => sum + p.amount, 0);
  return Math.floor(total / 100) * POINTS_PER_100;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const phone = (url.searchParams.get("phone") || "").trim();

  if (!phone) {
    return Response.json({ error: "phone is required" }, { status: 400 });
  }

  const customer = await env.DB.prepare(
    "SELECT phone, name FROM customers WHERE phone = ?"
  ).bind(phone).first();

  if (!customer) {
    return Response.json({
      phone,
      name: null,
      history: [],
      points: 0,
      isNew: true
    });
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
