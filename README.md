# Great Weather with Bobby

A bilingual (Bulgarian/English) weather dashboard built with React, TypeScript,
and Vite. It combines current conditions, a 24-hour outlook, a 14-day forecast,
air-quality data, marine conditions, weather alerts, charts, geolocation, city
search, favorites, and light/dark themes in one responsive interface.

## Data sources

The application reads public, client-side data from:

- [Open-Meteo Weather API](https://open-meteo.com/en/docs)
- [Open-Meteo Geocoding API](https://open-meteo.com/en/docs/geocoding-api)
- [Open-Meteo Air Quality API](https://open-meteo.com/en/docs/air-quality-api)
- [Open-Meteo Marine API](https://open-meteo.com/en/docs/marine-weather-api)
- [OpenStreetMap Nominatim](https://nominatim.org/release-docs/latest/api/Reverse/)

No server, database, or API key is required. Browser geolocation is optional and
is only requested when the user chooses **My Location**.

## Local development

### Requirements

- Node.js 20 or newer
- npm 10 or newer

```bash
git clone <repository-url>
cd <repository-directory>
npm ci
cp .env.example .env.local # optional; documents the environment setup
npm run dev
```

Vite prints the local URL (normally `http://localhost:5173`).

## Available commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the Vite development server with hot reload. |
| `npm run build` | Type-check and create the production bundle in `dist/`. |
| `npm run lint` | Run Oxlint. |
| `npm run preview` | Serve the production bundle locally. |

## Environment variables

There are currently **no required environment variables**. The browser calls
the public weather services directly. `.env.example` is intentionally kept as
the source of truth for configuration and can be extended if runtime options are
introduced later.

Only variables prefixed with `VITE_` are exposed by Vite to browser code. Never
put secrets or private API keys in a `VITE_` variable: their values are embedded
in the production JavaScript bundle and are visible to every visitor.

After changing a Vercel environment variable, trigger a new deployment because
Vite substitutes environment values at build time.

## Deploying to Vercel

The checked-in [`vercel.json`](./vercel.json) configures the Vite build, SPA
fallback, and production security headers.

### Vercel dashboard

1. Import the Git repository in Vercel.
2. Keep **Framework Preset** set to **Vite**.
3. Use `npm run build` as the build command and `dist` as the output directory
   (the repository configuration already supplies these values).
4. No environment variables need to be added.
5. Deploy. Pushes to the production branch create production deployments;
   other branches and pull requests create previews.

### Vercel CLI

```bash
npx vercel          # create a preview deployment
npx vercel --prod   # create a production deployment
```

Geolocation requires a secure context in production; Vercel deployments use
HTTPS automatically. If the deployment is placed behind a restrictive network,
allow requests to the Open-Meteo and OpenStreetMap endpoints listed above.

## Production verification

Before deploying, run:

```bash
npm ci
npm run lint
npm run build
npm run preview
```

Then verify city search, browser geolocation, theme/language toggles, and the
weather, air-quality, and marine responses in a current desktop and mobile
browser.

## Privacy notes

- A selected favorite city is stored only in the browser's `localStorage`.
- Coordinates are sent to the public data providers when forecasts or reverse
  geocoding are requested.
- The project does not include first-party analytics, accounts, or a backend.
