import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url'; // <== يجب إضافة هذا
import { dirname } from 'path';      // <== يجب إضافة هذا

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(bodyParser.json());

let clients = [];

app.use(express.static(path.join(__dirname, '..', 'client')));

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'index.html'));
});
app.post('/api/chat', async (req, res) => {
  const { message, convId, code } = req.body;
  broadcast({ type: 'assistant_message', text: 'Processing...' });

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if(!GEMINI_KEY){ // ✅ التحقق من GEMINI_KEY
    setTimeout(()=> broadcast({ type:'assistant_message', text:'No GEMINI_API_KEY set on server.'}), 400);
    return res.json({ status: 'no-key' });
  }
  
  try{
    // ✅ تصحيح بنية نداء fetch واستخدام رابط البث الصحيح
    const resp = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=' + GEMINI_KEY, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: message + "\n\nCurrent code:\n" + (code||'') }] }],
        config: {
          maxOutputTokens: 800,
          temperature: 0.2
        }
      })
    });
      
    if(!resp.ok){
      const txt = await resp.text();
      // ✅ تصحيح رسالة الخطأ
      broadcast({ type:'assistant_message', text: 'Gemini error: ' + txt.substring(0,200) });
      return res.json({ status:'gemini-error' });
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    
    // ✅ منطق معالجة تدفق Gemini
    while(true){
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: true });
      
      const lines = buffer.split('\n');
      buffer = lines.pop(); // الاحتفاظ بالسطر الأخير غير المكتمل في المخزن المؤقت
      
      for(const line of lines){
        if(line.trim().length === 0) continue;
        try{
          const parsed = JSON.parse(line);
          // تحليل بنية استجابة Gemini
          const chunk = parsed.candidates && parsed.candidates[0] && parsed.candidates[0].content && parsed.candidates[0].content.parts[0].text;
          
          if(chunk){
            broadcast({ type:'assistant_message', text: chunk });
          }
        }catch(e){
          // تجاهل أخطاء التحليل للخطوط الجزئية أو غير الصالحة
        }
      }
      if(done) break;
    }
    
    broadcast({ type:'assistant_message', text:'\n[STREAM COMPLETE]' });
    res.json({ status:'ok' });
  }catch(err){
    console.error(err);
    broadcast({ type:'assistant_message', text: 'Server error: ' + err.message });
    res.json({ status:'error' });
  }
});


app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive'
  });
  res.flushHeaders();
  const id = Date.now();
  clients.push({ id, res });
  req.on('close', ()=> { clients = clients.filter(c => c.id !== id); });
});

function broadcast(payload){
  const s = 'data: ' + JSON.stringify(payload) + '\n\n';
  clients.forEach(c => c.res.write(s));
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, ()=> console.log('Server listening on', PORT));
                  
