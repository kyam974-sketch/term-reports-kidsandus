# Term Reports · Kids&Us

Generatore di term report personalizzati con login Supabase e storico persistente.

---

## Struttura

```
term-reports-kidsandus/
├── server.js            ← proxy Node.js verso Anthropic (la API key non è nel codice)
├── package.json
├── .gitignore
└── public/
    └── index.html       ← tutta l'app frontend
```

---

## Setup completo — passo dopo passo

### PASSO 1 · Supabase — crea il progetto e il database

1. Vai su [supabase.com](https://supabase.com) → **New project**
2. Scegli un nome (es. `term-reports`) e una password per il database
3. Regione: **West EU (Ireland)** — la più vicina all'Italia

**Crea la tabella `reports`:**

Nel menu di sinistra vai su **SQL Editor** → **New query** → incolla questo SQL e clicca **Run**:

```sql
-- Tabella reports
create table reports (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  student_name text not null,
  course       text not null,
  trimestre    text not null,
  gender       text,
  parent_type  text,
  oral_test    text,
  report_type  text default 'trimestrale',
  sections     jsonb not null,
  created_at   timestamptz default now()
);

-- Row Level Security: ogni utente vede solo i propri report
alter table reports enable row level security;

create policy "Utente vede solo i propri report"
  on reports for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

**Crea il tuo account utente:**

Vai su **Authentication → Users → Add user → Create new user**
- Email: la tua email
- Password: scegli una password sicura
- ✅ spunta "Auto Confirm User"

**Trova le tue chiavi API:**

Vai su **Project Settings → API** e copia:
- **Project URL** (es. `https://xxxxxxxxxxxx.supabase.co`)
- **anon public** key (stringa lunga che inizia con `eyJ...`)

---

### PASSO 2 · Inserisci le chiavi Supabase nel frontend

Apri `public/index.html` e cerca queste due righe verso l'inizio dello script:

```javascript
const SUPABASE_URL  = 'INSERISCI_QUI_IL_TUO_SUPABASE_URL';
const SUPABASE_ANON = 'INSERISCI_QUI_LA_TUA_SUPABASE_ANON_KEY';
```

Sostituiscile con i valori reali, es.:

```javascript
const SUPABASE_URL  = 'https://xxxxxxxxxxxx.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';
```

> ✅ La `anon` key di Supabase è **progettata per stare nel frontend** — è pubblica per design.
> La sicurezza vera viene dalle Row Level Security policies che abbiamo creato nel database:
> ogni utente può leggere e scrivere **solo i propri dati**.

---

### PASSO 3 · GitHub — crea il repository e carica il codice

1. Vai su [github.com](https://github.com) → **New repository**
2. Nome: `term-reports-kidsandus`
3. Visibilità: **Public** (necessario per Render gratuito)
4. **Non** inizializzare con README
5. Clicca **Create repository**

Apri il Terminale nella cartella del progetto:

```bash
git init
git add .
git commit -m "Prima versione term reports"
git branch -M main
git remote add origin https://github.com/TUO-USERNAME/term-reports-kidsandus.git
git push -u origin main
```

---

### PASSO 4 · Render — deploy del server

1. Vai su [render.com](https://render.com) → **New → Web Service**
2. Connetti il tuo account GitHub
3. Seleziona il repository `term-reports-kidsandus`
4. Configura:
   - **Name:** `term-reports-kidsandus`
   - **Region:** Frankfurt (EU Central)
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance Type:** Free

5. Vai su **Environment → Add Environment Variable:**

   | Key | Value |
   |-----|-------|
   | `ANTHROPIC_API_KEY` | `sk-ant-api03-...` |

6. Clicca **Create Web Service**

Render impiega 2-3 minuti per il primo deploy. Al termine ti fornisce un URL tipo:
`https://term-reports-kidsandus.onrender.com`

---

### PASSO 5 · Test finale

1. Apri l'URL di Render nel browser
2. Accedi con email e password che hai creato su Supabase
3. Genera un report di test e salvalo → comparirà nello Storico

---

## Aggiornare l'app in futuro

Ogni volta che modifichi qualcosa (prompt, UI, funzionalità):

```bash
git add .
git commit -m "Descrizione modifica"
git push
```

Render riconosce il push e rideploya automaticamente in 1-2 minuti.

---

## Note importanti

| Cosa | Dove sta | Perché è sicuro |
|------|----------|-----------------|
| `ANTHROPIC_API_KEY` | Variabile d'ambiente Render | Non è nel codice, non va su GitHub |
| `SUPABASE_URL` + `SUPABASE_ANON` | `public/index.html` | La `anon` key è pubblica per design; le RLS policies proteggono i dati |
| Password utenti | Supabase Auth | Gestite da Supabase, mai nel codice |
| Report salvati | Database Supabase | Ogni utente accede solo ai propri (RLS) |

---

## Aggiungere altri utenti in futuro

Se vuoi che anche una collega acceda all'app:
- Supabase → **Authentication → Users → Add user**
- Crea le credenziali e condividile con lei
- I suoi report saranno separati dai tuoi (grazie alle RLS policies)
