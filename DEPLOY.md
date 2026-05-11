# Deployment guide

Your app has two pieces that deploy separately:

- **Client** (`/client`) → static files. Hosted on Vercel or Netlify.
- **Server** (`/server`) → Node + WebSocket process. Hosted on Render or Fly or Railway.

You'll deploy the server first (so you have its URL), then build the client pointing at it, then deploy the client.

---

## Step 0 — push to GitHub

All three hosts (Render, Vercel, Netlify) deploy from a Git repo. Push the project to GitHub:

```bash
cd beatbattle
git init
git add .
git commit -m "initial"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/beatbattle.git
git push -u origin main
```

If you already have a repo skip this.

---

## Step 1 — deploy the server (Render.com)

1. Sign up at https://render.com (free, no credit card).
2. Dashboard → **New +** → **Web Service**.
3. Connect your GitHub repo. Pick the `beatbattle` repo.
4. Fill in:
   - **Name**: `beatbattle-server` (this becomes part of your URL)
   - **Region**: pick closest to you
   - **Branch**: `main`
   - **Root Directory**: `server`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
5. Scroll to **Environment Variables**. Add:
   - `CLIENT_ORIGIN` — leave blank for now (we'll set it after Step 2)
   - `BATTLE_SECONDS` — optional, set to `60` if you want fast testing instead of 10-minute matches
6. Click **Create Web Service**.

After 2–3 minutes you'll get a URL like `https://beatbattle-server.onrender.com`. Visit `https://beatbattle-server.onrender.com/health` — should return `{"ok":true}`. **Copy that URL.**

**Free-tier catch:** the instance sleeps after 15 minutes of no traffic. First request after sleep takes ~30 seconds to wake up. Upgrade to $7/mo if that bothers you, or use Fly.io instead.

---

## Step 2 — deploy the client (Vercel)

1. Sign up at https://vercel.com (free).
2. **Add New… → Project**. Import the same repo.
3. Vercel auto-detects Vite. Override these:
   - **Root Directory**: `client`
   - **Framework Preset**: Vite (auto)
   - **Build Command**: `npm run build` (auto)
   - **Output Directory**: `dist` (auto)
4. **Environment Variables** → add:
   - `VITE_SERVER_URL` = the Render URL from Step 1 (e.g. `https://beatbattle-server.onrender.com`).
   Important: include `https://`, no trailing slash.
5. **Deploy**.

You'll get a URL like `https://beatbattle-yourname.vercel.app`. **Copy that.**

---

## Step 3 — close the CORS loop

Go back to Render → your service → **Environment**. Set:

- `CLIENT_ORIGIN` = your Vercel URL (e.g. `https://beatbattle-yourname.vercel.app`)

Save. Render redeploys automatically (~1 minute). Without this step the browser will block the WebSocket connection from the deployed client to the deployed server.

If you later add a custom domain, append it to `CLIENT_ORIGIN` comma-separated:
`https://beatbattle-yourname.vercel.app,https://beatbattle.com`

---

## Step 4 — test it

Open your Vercel URL in two browser windows (one regular, one incognito). Quick-Battle from both. You should match up and play just like locally.

If it doesn't connect:

- **Open browser DevTools → Console.** Look for a CORS error or WebSocket failure. CORS error means `CLIENT_ORIGIN` doesn't match — copy the exact origin from the error message into Render.
- **Render → Logs.** Verify the server actually started ("listening on :PORT") and is receiving connections.
- **Health check.** Visit `https://YOUR-SERVER.onrender.com/health` directly. If that returns `{"ok":true}` the server is fine and the issue is on the client side.

---

## Alternative hosts (if you don't like Render)

### Server alternatives

- **Fly.io** — $0–$2/mo always-on, no cold start. More config (Dockerfile, `fly.toml`). Better for production.
- **Railway.app** — easier than Fly, $5/mo minimum.
- **DigitalOcean App Platform** — $5/mo, simple.

For any of them, the requirements are the same: Node 18+, `npm install` builds, `npm start` runs, port comes from `$PORT`. The code as written works on all of them.

### Client alternatives

- **Netlify** — basically identical UX to Vercel. Pick whichever.
- **Cloudflare Pages** — fast CDN, generous free tier.

### Don't bother trying

- **Vercel / Netlify for the SERVER.** Their serverless functions don't support long-lived WebSocket connections. You'll waste time fighting it. Use them for the client only.
- **GitHub Pages.** Static-only — no env vars at build time. Can't inject `VITE_SERVER_URL`. (Workaround exists but it's gross — just use Vercel.)

---

## Known limitations of this deployment

- **State persistence depends on disk setup.** The store writes to a JSON file (`./.data/store.json` by default). On Render's free tier the filesystem is ephemeral — the file gets wiped on every redeploy. To actually persist leaderboard and ELO across restarts, you need one of:
  - **Add a Render Disk** ($1/mo). Render → service → Disks → Add Disk. Mount path: `/var/data`, size: 1 GB. Then set the env var `DATA_DIR=/var/data`. Restart. Now writes survive redeploys.
  - **Switch host** to one with persistent disk by default (Fly.io volumes, DigitalOcean, etc.)
  - **Swap the store** for an external DB. The store.js API is intentionally narrow (`getOrCreateUser`, `recordMatch`, `leaderboard`, `recentMatches`) — about 50 lines of code to swap for SQLite, Postgres (Supabase/Neon), or Turso.
- **No horizontal scaling.** All rooms live in one process's memory. Two server instances wouldn't share state. To scale: add Redis for shared room state and use `@socket.io/redis-adapter`. You will not need this until you have more than a few hundred concurrent players.
- **No DDoS protection beyond what Render/Cloudflare give you for free.** Don't post the URL to /r/all without thinking it through.

---

## Custom domain (optional)

Both Vercel and Render let you point a domain at the deployment for free.

1. Buy a domain (Namecheap, Cloudflare Registrar, whatever).
2. **Vercel** → Project → Settings → Domains → add your domain. Vercel tells you what DNS records to add.
3. **Render** → service → Settings → Custom Domain → same flow.
4. After both are live, update Render's `CLIENT_ORIGIN` to your new domain.

Cloudflare in front of Vercel/Render works fine and gives you analytics and basic protection for free. Don't enable Cloudflare's "Proxy" (orange cloud) on the Render subdomain or it will mangle the WebSocket — leave that one DNS-only (grey cloud).
