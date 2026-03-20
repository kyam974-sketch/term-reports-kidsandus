const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Proxy Anthropic ──────────────────────────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY non configurata.' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(req.body)
    });
    const data = await response.json();
    if (!response.ok) return res.status(response.status).json(data);
    res.json(data);
  } catch (err) {
    console.error('Errore Anthropic:', err);
    res.status(500).json({ error: 'Errore interno del server.' });
  }
});

// ── Salvataggio report via service_role (bypassa RLS) ────────────────────────
app.post('/api/save-report', async (req, res) => {
  const supabaseUrl  = process.env.SUPABASE_URL;
  const serviceKey   = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase non configurato sul server.' });
  }

  const { report, token } = req.body;
  if (!report || !token) {
    return res.status(400).json({ error: 'Dati mancanti.' });
  }

  try {
    // 1. Verifica il token JWT per ottenere user_id
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'apikey': serviceKey
      }
    });

    if (!userRes.ok) {
      return res.status(401).json({ error: 'Token non valido o sessione scaduta.' });
    }

    const userData = await userRes.json();
    const userId = userData.id;

    if (!userId) {
      return res.status(401).json({ error: 'Utente non trovato.' });
    }

    // 2. Inserisce il report con service_role (nessun problema di RLS)
    const insertRes = await fetch(`${supabaseUrl}/rest/v1/reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ ...report, user_id: userId })
    });

    const insertData = await insertRes.json();

    if (!insertRes.ok) {
      console.error('Errore insert:', insertData);
      return res.status(insertRes.status).json({ error: insertData.message || 'Errore nel salvataggio.' });
    }

    res.json({ success: true, data: insertData });

  } catch (err) {
    console.error('Errore save-report:', err);
    res.status(500).json({ error: 'Errore interno del server.' });
  }
});

// ── Lettura storico via service_role ─────────────────────────────────────────
app.post('/api/get-reports', async (req, res) => {
  const supabaseUrl  = process.env.SUPABASE_URL;
  const serviceKey   = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase non configurato sul server.' });
  }

  const { token, filters } = req.body;
  if (!token) return res.status(400).json({ error: 'Token mancante.' });

  try {
    // Verifica token
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sessione scaduta.' });
    const userData = await userRes.json();
    const userId = userData.id;

    // Costruisce query
    let url = `${supabaseUrl}/rest/v1/reports?user_id=eq.${userId}&order=created_at.desc`;
    if (filters?.course) url += `&course=eq.${filters.course}`;
    if (filters?.trimestre) url += `&trimestre=eq.${filters.trimestre}`;
    if (filters?.name) url += `&student_name=ilike.*${filters.name}*`;

    const dataRes = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      }
    });
    const data = await dataRes.json();
    res.json({ success: true, data });

  } catch (err) {
    console.error('Errore get-reports:', err);
    res.status(500).json({ error: 'Errore interno.' });
  }
});

// ── Rinomina studente ────────────────────────────────────────────────────────
app.post('/api/rename-student', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  const { token, id, newName } = req.body;
  if (!token || !id || !newName) return res.status(400).json({ error: 'Dati mancanti.' });

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sessione scaduta.' });
    const userData = await userRes.json();

    const updateRes = await fetch(`${supabaseUrl}/rest/v1/reports?id=eq.${id}&user_id=eq.${userData.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      },
      body: JSON.stringify({ student_name: newName })
    });

    if (!updateRes.ok) return res.status(updateRes.status).json({ error: 'Errore aggiornamento.' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Errore interno.' });
  }
});

// ── Elimina report ───────────────────────────────────────────────────────────
app.post('/api/delete-report', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  const { token, id } = req.body;
  if (!token || !id) return res.status(400).json({ error: 'Dati mancanti.' });

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sessione scaduta.' });
    const userData = await userRes.json();

    const delRes = await fetch(`${supabaseUrl}/rest/v1/reports?id=eq.${id}&user_id=eq.${userData.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'apikey': serviceKey
      }
    });

    if (!delRes.ok) return res.status(delRes.status).json({ error: 'Errore eliminazione.' });
    res.json({ success: true });

  } catch (err) {
    res.status(500).json({ error: 'Errore interno.' });
  }
});

// ── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
