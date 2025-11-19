import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

// قائمة SSE
let clients = [];

function broadcast(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(c => {
    try { c.res.write(msg); }
    catch(e) { console.error("❌ Broadcast error:", e); }
  });
}

// ملفات الواجهة
app.use(express.static(path.join(__dirname, '..', 'client')));

// =======================
// 🟦 API CHAT (مع Debug)
// =======================
app.post('/api/chat', async (req, res) => {

  console.log("========================================");
  console.log("📥 Received /api/chat request");
  console.log("User message:", req.body.message);
  console.log("Conversation:", req.body.convId);
  console.log("========================================");

  const { message, code } = req.body;

  const GEMINI_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_KEY) {
    console.log("❌ ERROR: GEMINI_API_KEY is NOT SET");
    broadcast({ type:'assistant_message', text:'No GEMINI_API_KEY set on server.'});
    return res.json({ status: 'no-key' });
  }

  console.log("🔑 GEMINI_API_KEY found ✓");
  
  try {

    console.log("🌐 Sending request to Gemini…");

    const payload = {
      contents: [{
        parts: [{ 
          text: message + "\n\nCurrent code:\n" + (code || '')
        }]
      }],
      generationConfig: {
        systemInstruction: "You are an expert coder. Reply in markdown."
      }
    };

    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:streamGenerateContent?key='
      + GEMINI_KEY;

    console.log("➡ Calling URL:", url);

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    console.log("⬅ Gemini response status:", resp.status);

    if (!resp.ok) {
      const txt = await resp.text();
      console.log("❌ Gemini returned error:", txt);
      broadcast({ type:'assistant_message', text:'API Error: ' + txt });
      return res.json({ status: 'api-error' });
    }

    console.log("📡 Starting to read Gemini stream…");

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { value, done } = await reader.read();

      if (done) {
        console.log("🔚 Stream finished");
        break;
      }

      const chunkText = decoder.decode(value, { stream:true });
      console.log("📨 Raw chunk:", chunkText);

      buffer += chunkText;

      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (line.trim() === '') continue;

        try {
          const parsed = JSON.parse(line);
          const part = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;

          console.log("➡ Parsed chunk:", part);

          if (part)
            broadcast({ type:'assistant_message', text: part });

        } catch(e) {
          console.log("⚠ Chunk parsing failed:", line);
        }
      }
    }

    broadcast({ type:'assistant_message', text:'\n[STREAM COMPLETE]' });
    res.json({ status:'ok' });

  } catch (err) {
    console.log("❌ Server error inside /api/chat:", err);
    broadcast({ type:'assistant_message', text: 'Server error: ' + err.message });
    res.json({ status:'error' });
  }
});

// =======================
// 🟩 SSE EVENTS
// =======================
app.get('/api/events', (req, res) => {
  console.log("🔵 New SSE connection");

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });

  res.flushHeaders();

  const id = Date.now();
  clients.push({ id, res });

  res.write(`data: {"type":"connected","text":"SSE connection established."}\n\n`);

  req.on('close', () => {
    console.log("🔴 SSE disconnected");
    clients = clients.filter(c => c.id !== id);
  });
});

// =======================
// 🟧 Fallback
// =======================
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});

// =======================
// 🟨 Start server
// =======================
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});