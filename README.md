# Noorie CRM

Phone-number based customer ledger for Noorie Enterprise — search a customer
by phone number, view purchase history and points, add today's purchase, and
message the customer on WhatsApp (chat, bill copy, or reward status) directly
from the same page.

- **Frontend**: `public/index.html` — single page, no build step
- **Backend**: Cloudflare Pages Functions in `functions/api/` (`customer.js`,
  `purchase.js`), backed by a Cloudflare D1 database
- **Data**: lives entirely in your own Cloudflare account. D1 is SQLite under
  the hood — if you ever want to move off Cloudflare, you can export the
  database file and run it on your own server with no code changes to the
  data layer.

## One-time setup

1. **Install Wrangler** (Cloudflare's CLI), if you don't have it:
   ```
   npm install -g wrangler
   wrangler login
   ```

2. **Create the D1 database:**
   ```
   wrangler d1 create noorie-crm-db
   ```
   This prints a `database_id` — copy it.

3. **Create `wrangler.toml`** in the project root with that ID:
   ```toml
   name = "noorie-crm"
   pages_build_output_dir = "public"

   [[d1_databases]]
   binding = "DB"
   database_name = "noorie-crm-db"
   database_id = "PASTE_YOUR_DATABASE_ID_HERE"
   ```

4. **Load the schema:**
   ```
   wrangler d1 execute noorie-crm-db --remote --file=./schema.sql
   ```

5. **Deploy to Cloudflare Pages**, connected to this GitHub repo:
   - In the Cloudflare dashboard: Workers & Pages → Create → Pages →
     Connect to Git → select `Noorie-CRM`
   - Build output directory: `public`
   - After the first deploy, go to the Pages project → Settings →
     Functions → D1 database bindings → add binding `DB` → your
     `noorie-crm-db` database
   - Redeploy once the binding is added

Once deployed, every push to `main` auto-updates the live site.

## Adding your logo

Replace the placeholder circle in `public/index.html`:
```html
<div class="logo">
  <span>N</span>
</div>
```
with:
```html
<div class="logo">
  <img src="logo.png" alt="Noorie">
</div>
```
and drop `logo.png` into the `public/` folder.

## Points system

₹100 spent = 1 point. Reward unlocks every 20 points. To change this, edit
`POINTS_PER_100` and `REWARD_THRESHOLD` in `public/index.html`, and
`POINTS_PER_100` in `functions/api/customer.js` and `functions/api/purchase.js`.

## WhatsApp numbers

The app assumes 10-digit Indian phone numbers and prefixes `91` automatically
when opening WhatsApp links. If you'll be storing numbers with a different
country code, adjust `toWaNumber()` in `public/index.html`.
