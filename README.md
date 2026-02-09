# SplitNest

SplitNest is a lightweight expense-splitting web app built with React + Vite.

It supports:
- Admin login to manage participants and expenses
- Shared user login where people choose who they represent
- Automatic split calculations (who owes whom)
- Local persistence in browser storage (no backend required)

## Demo credentials

- Admin: `admin / admin123`
- Shared user: `group / group123`

## Local development

```bash
npm install
npm run dev
```

## Production build

```bash
npm run build
npm run preview
```

## Deploy to Vercel (free)

This repo is already Vercel-ready as a static Vite app.

### Option A: Vercel dashboard (fastest)
1. Open `https://vercel.com/new`
2. Import this GitHub repo: `sanketpatrikar/splitnest`
3. Keep defaults (Vite auto-detected)
4. Deploy

Expected settings:
- Build command: `npm run build`
- Output directory: `dist`

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel
```

Follow prompts, then for production:

```bash
vercel --prod
```
