const express = require('express');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ── Ping endpoint per heartbeat ──────────────────────────────────────────────
app.get('/api/ping', (_req, res) => res.json({ ok: true }));

// ── Proxy Anthropic con fallback Gemini ──────────────────────────────────────
app.post('/api/generate', async (req, res) => {
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;

  // Tenta Anthropic prima
  if (anthropicKey) {
    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(req.body)
      });
      const data = await response.json();
      if (!response.ok) {
        console.warn('Antropic error:', response.status, data);
        // Se Anthropic fallisce, prova Gemini
        if (geminiKey) {
          return tryGemini(req, res, geminiKey);
        }
        return res.status(response.status).json(data);
      }
      return res.json(data);
    } catch (err) {
      console.error('Errore Anthropic:', err);
      // Se Anthropic fallisce, prova Gemini
      if (geminiKey) {
        return tryGemini(req, res, geminiKey);
      }
      return res.status(500).json({ error: 'Errore Anthropic e Gemini non configurato.' });
    }
  }

  // Se Anthropic non è configurata, prova Gemini
  if (geminiKey) {
    return tryGemini(req, res, geminiKey);
  }

  res.status(500).json({ error: 'Nessuna API key configurata (ANTHROPIC_API_KEY o GEMINI_API_KEY).' });
});

async function tryGemini(req, res, geminiKey) {
  try {
    // Converti il formato Anthropic al formato Gemini
    const { model, messages, max_tokens, system } = req.body;
    
    // Prepara il contenuto per Gemini
    const contents = messages.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    // Aggiungi il system prompt come primo messaggio dell'utente se presente
    let geminiMessages = contents;
    if (system) {
      geminiMessages = [
        { role: 'user', parts: [{ text: system }] },
        { role: 'model', parts: [{ text: 'Capito. Seguirò queste istruzioni.' }] },
        ...contents
      ];
    }

    const geminiModel = model ? model.replace('claude-', 'gemini-') : 'gemini-1.5-pro';
    
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          contents: geminiMessages,
          generationConfig: {
            maxOutputTokens: max_tokens || 4096,
            temperature: 1.0
          }
        })
      }
    );

    const data = await response.json();
    
    if (!response.ok) {
      console.error('Errore Gemini:', data);
      return res.status(response.status).json({ error: data.error?.message || 'Errore Gemini.' });
    }

    // Converti la risposta Gemini al formato Anthropic per compatibilità
    const geminiText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const convertedResponse = {
      id: 'gemini-' + Date.now(),
      type: 'message',
      role: 'assistant',
      content: [{ type: 'text', text: geminiText }],
      model: geminiModel,
      stop_reason: 'end_turn',
      usage: {
        input_tokens: data.usageMetadata?.promptTokenCount || 0,
        output_tokens: data.usageMetadata?.candidatesTokenCount || 0
      }
    };

    return res.json(convertedResponse);
  } catch (err) {
    console.error('Errore Gemini:', err);
    return res.status(500).json({ error: 'Errore interno del server (Gemini).' });
  }
}

// ── Salvataggio report via service_role ──────────────────────────────────────
app.post('/api/save-report', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Supabase non configurato sul server.' });
  }

  const { report, token } = req.body;
  if (!report || !token) return res.status(400).json({ error: 'Dati mancanti.' });

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Token non valido o sessione scaduta.' });
    const userData = await userRes.json();
    const userId = userData.id;
    if (!userId) return res.status(401).json({ error: 'Utente non trovato.' });

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

// ── Lettura storico ──────────────────────────────────────────────────────────
app.post('/api/get-reports', async (req, res) => {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey  = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl || !serviceKey) return res.status(500).json({ error: 'Supabase non configurato.' });

  const { token, filters } = req.body;
  if (!token) return res.status(400).json({ error: 'Token mancante.' });

  try {
    const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': serviceKey }
    });
    if (!userRes.ok) return res.status(401).json({ error: 'Sessione scaduta.' });
    const userData = await userRes.json();
    const userId = userData.id;

    let url = `${supabaseUrl}/rest/v1/reports?user_id=eq.${userId}&order=created_at.desc`;
    if (filters?.centro) url += `&centro=eq.${encodeURIComponent(filters.centro)}`;
    if (filters?.course) url += `&course=eq.${filters.course}`;
    if (filters?.trimestre) url += `&trimestre=eq.${filters.trimestre}`;
    if (filters?.name) url += `&student_name=ilike.*${filters.name}*`;

    const dataRes = await fetch(url, {
      headers: { 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey }
    });
    const data = await dataRes.json();
    res.json({ success: true, data });
  } catch (err) {
    console.error('Errore get-reports:', err);
    res.status(500).json({ error: 'Errore interno.' });
  }
});

// ── Elimina report ────────────────────────────────────────────────────────────
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
      headers: { 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey }
    });
    if (!delRes.ok) return res.status(delRes.status).json({ error: 'Errore eliminazione.' });
    res.json({ success: true });
  } catch (err) {
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

// ── SPA fallback ──────────────────────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server attivo sulla porta ${PORT}`));
