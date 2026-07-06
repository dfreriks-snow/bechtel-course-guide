# Summit Bechtel Course Guide

A fullscreen, installable iPad web app (PWA) for driving the course at the
**Scouting America Summit Bechtel Reserve**. Tag points of interest with a
description and notes, then in **Drive** mode each point **auto-pops** on screen
for passengers as the vehicle comes within range.

Built with React + Vite + TypeScript + Leaflet. No Google Maps API key required —
it uses free satellite / topo / street imagery that can be **pre-downloaded for
offline use** (the Reserve has patchy cell coverage).

---

## Features

- **Plan mode** — tap the map to drop a pin, or “Drop point at my location”; add a
  name, category, description, notes, and a trigger radius. Drag pins to reposition.
- **Drive mode** — the map follows your GPS; when you get within a point’s radius,
  a large passenger card appears with its description + notes, plus a “coming up”
  list of the nearest points. Optional arrival chime. Keeps the screen awake.
- **Offline** — installable to the home screen; caches the app and map tiles.
  A “Download this area for offline” button pre-fetches tiles around your points.
- **Portable courses** — export/import the whole course as a `.json` file, so you
  can plan on a laptop and load it on the iPad (or share it).
- Everything is stored **on the device** (IndexedDB). No server, no account.

---

## Collaborative / shared editing (optional)

By default the course is stored **per-device**. To let your whole team edit **one
shared live course** (changes sync to everyone in ~1 second), connect a free
**Supabase** backend:

1. Create a free project at [supabase.com](https://supabase.com).
2. In the project, open **SQL Editor → New query**, paste the contents of
   [`supabase/schema.sql`](supabase/schema.sql), and **Run** it. This creates the
   `pois` table, access policies, and turns on realtime.
3. In **Settings → API**, copy the **Project URL** and the **anon public** key.
4. Wire them in:
   - **Local dev:** copy `.env.example` to `.env.local` and fill both values.
   - **Deployed site:** in the GitHub repo, **Settings → Secrets and variables →
     Actions → Variables**, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`,
     then re-run the Deploy workflow.

That's it — the app switches to shared mode automatically. The header shows a
status pill: **Local only / Connecting… / Shared · `<course>` / Offline (cached)**.

- **One course, everyone in sync.** All teammates editing the same link see each
  other's adds/moves/deletes live.
- **Multiple courses.** Add `?course=my-crew` to the URL to use a separate shared
  course (default is `jamboree`).
- **Offline.** The last-synced course is cached on-device, so Drive mode works
  with no signal; edits sync back when you're online again.
- **Access.** The anon key is public (it ships in the browser); the shared course
  is editable by anyone with the link. Fine for a team tour — tighten via the
  policies in `schema.sql` if you need to.

If you don't configure Supabase, the app simply stays local-only (no change).

---

## Publish it (share with others)

The app is a static site, so any HTTPS static host works. The simplest, free path
is **GitHub Pages** (included workflow):

1. Push this project to a GitHub repo (e.g. `bechtel-course-guide`).
2. In the repo: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. The included workflow (`.github/workflows/deploy.yml`) builds with the correct
   base path and publishes on every push to `main`.
4. Your app goes live at `https://<user>.github.io/<repo>/` — share that link.
   Anyone can open it, **Add to Home Screen**, and use it (the Summit Bechtel
   starter points are bundled in, so they get the map preloaded).

Because it's served over HTTPS, GPS works on visitors' phones/iPads. Other hosts
(Netlify, Vercel, Cloudflare Pages) work too — just deploy the `dist/` folder;
for a subpath deploy set `BASE_PATH=/<subpath>/` before `npm run build`.

> Note: sharing the public link publishes the map and your notes to anyone with
> the URL. Keep sensitive notes out of a published course, or host it privately.

---

## Run it (on your laptop)

```bash
cd bechtel-course-guide
npm install
npm run dev          # http://localhost:5199
```

Open `http://localhost:5199` in a browser. On `localhost`, GPS works for testing.

---

## Use it on the iPad

The iPad’s GPS only works on a **secure origin** (HTTPS or `localhost`). A plain
`http://<laptop-ip>` will load the map but **cannot read location**. Two options:

### Option A — Quick LAN test (self-signed HTTPS)

```bash
npm run dev:https        # serves https on port 5199
```

Vite prints a `https://10.0.0.x:5199` “Network” URL. On the iPad (same
Wi-Fi/hotspot as the laptop), open that URL in Safari and accept the certificate
warning (Advanced → Proceed). GPS will then work. Good for a quick trial.

### Option B — Recommended for real drives: deploy to HTTPS

Host the built app on any free static HTTPS host, then install it on the iPad.

```bash
npm run build            # outputs ./dist
```

Deploy `dist/` to Netlify, Vercel, GitHub Pages, or Cloudflare Pages (drag-and-drop
the folder or connect the repo). Then on the iPad:

1. Open the deployed `https://…` URL in **Safari**.
2. Tap **Share → Add to Home Screen**. Launch it from the icon → fullscreen app.
3. While you still have signal, open the ⚙ menu and tap **Download this area for
   offline** so the map works with no service on the course.
4. Allow **Location** when prompted (choose “While Using”).

> Because it’s a PWA, once installed and its area is downloaded, it runs fully
> offline in the vehicle.

---

## Typical workflow

1. **Plan** (at a desk or on-site): switch to **Plan**, tap the map to drop pins
   for each stop, and fill in the description + talking-point notes. Set each
   point’s trigger radius (default 75 m) so the card appears at the right moment.
2. **Back up / transfer**: ⚙ → **Export course** to save a `.json`. Import it on
   the iPad (or any device) via ⚙ → **Import course**.
3. **Pre-cache**: ⚙ → **Download this area for offline** while you have signal.
4. **Drive**: switch to **Drive**. Mount the iPad facing the passengers. As you
   approach each tagged site its card pops up automatically.

---

## Notes & limitations

- **Map imagery**: Esri World Imagery (satellite), USGS Topo, and OpenStreetMap.
  These are free for light use. If you specifically want the Google Maps look
  online, a Google tile layer can be added with a billing-enabled API key —
  but Google’s tiles can’t be legally cached for offline use, which is why the
  default stack is Leaflet + Esri/USGS/OSM.
- **Offline download** caches zoom levels 12–17 around your points; very large
  areas are capped to avoid huge downloads. Add points before downloading.
- **Background GPS**: a web app only tracks while the screen is on and the app is
  foreground — hence the wake-lock. For always-on background tracking you’d need
  a native app.
- Default map center is the Summit Bechtel Reserve (≈37.917, −81.115); it recenters
  on your location in Drive mode.

---

## Project layout

```
src/
├── App.tsx                 # app shell, mode switching, drive-trigger logic
├── main.tsx
├── index.css
├── components/
│   ├── MapView.tsx         # Leaflet map, layers, pins, live-location dot
│   ├── PoiEditor.tsx       # add/edit a point (name, notes, category, radius)
│   ├── PoiList.tsx         # course list drawer + reorder
│   └── DriveCard.tsx       # passenger-facing arrival card
├── hooks/
│   ├── useGeolocation.ts   # watchPosition tracker
│   └── useWakeLock.ts      # keep screen awake while driving
└── lib/
    ├── types.ts            # Poi model + categories
    ├── geo.ts              # haversine + distance formatting
    ├── store.ts            # IndexedDB persistence + JSON import/export
    └── tiles.ts            # tile layers + offline prefetch
```

## Scripts

| Command | What it does |
|---------|--------------|
| `npm run dev` | Dev server on `http://localhost:5199` |
| `npm run dev:https` | Dev server over self-signed HTTPS (for iPad GPS on LAN) |
| `npm run build` | Production build to `dist/` |
| `npm run preview` | Serve the production build locally |
