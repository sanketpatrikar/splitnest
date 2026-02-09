# SplitNest

SplitNest is a lightweight expense-splitting web app built with React + Vite.

It supports:
- Admin login to manage participants and expenses
- Shared user login where people choose who they represent
- Automatic split calculations (who owes whom)
- Shared persistence with Supabase (same data on all devices)

## Demo credentials

- Admin: `admin / i_am_admin!`
- Shared user: `user / user`

## One-time Supabase setup (5 minutes)

1. Create a new Supabase project.
2. Open SQL Editor in Supabase and run `supabase/schema.sql` from this repo.
3. In Supabase -> Project Settings -> API, copy:
   - Project URL
   - Anon public key
4. Create a local env file from `.env.example`:

```bash
copy .env.example .env
```

5. Fill `.env` with your Supabase values.

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

Add these Environment Variables in Vercel Project Settings:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

### Option B: Vercel CLI

```bash
npm i -g vercel
vercel
```

Follow prompts, then for production:

```bash
vercel --prod
```
