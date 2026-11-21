# Founder Outreach CRM

A responsive, single-user CRM for managing founder and product-leader outreach.

## Run locally

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Current MVP notes

- Data is stored in browser localStorage. This is a single-browser MVP, not a cloud-synced multi-user system.
- LinkedIn workflow is manual: the app can prepare/copy messages, but does not scrape or automate LinkedIn activity.
- Email sending and live LLM integration are not configured in this MVP; message generation uses local templates.

## Deploy

The project is configured for Vite and can be deployed to Vercel with the default build command `npm run build` and output directory `dist`.
