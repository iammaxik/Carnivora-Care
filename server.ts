import express from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = 3000;

// Support larger payloads for camera/gallery image uploads
app.use(express.json({ limit: '25mb' }));

const apiKey = process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.VITE_GEMINI_API_KEY || '';

const ai = new GoogleGenAI({
  apiKey: apiKey,
  httpOptions: {
    headers: {
      'User-Agent': 'aistudio-build',
    },
  },
});

function extractJson(text: string): any {
  // 2. ROBUSTES JSON-STRIPPING & PARSING
  let cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleanText);
  } catch (e1) {
    // Regex to extract the first valid JSON object { ... }
    const match = cleanText.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw e1;
  }
}

const getDemoDiagnosis = () => ({
  isDemo: true,
  plantIdentified: "Dionaea muscipula (Venusfliegenfalle)",
  vitalityScore: 82,
  diagnosisSummary: "Demo-Modus aktiv: Dionaea muscipula analysiert. Das Exemplar weist eine gute Wuchsform auf; ältere Fallenränder zeigen leichte Mineralienempfindlichkeit.",
  issues: [
    {
      title: "Mineralienempfindlichkeit",
      severity: "mittel",
      description: "Leichte nekrotische Verfärbung an den äußeren Blattzähnen. Hinweis auf Gießwasser mit zu hohem Leitwert (> 50 ppm TDS)."
    },
    {
      title: "Lichtmangel (Etiolement)",
      severity: "keine",
      description: "Falleninneres weist kräftige Anthocyan-Rotfärbung auf. Keine Anzeichen von Lichtmangel."
    },
    {
      title: "Pilzbefall / Fäulnis",
      severity: "keine",
      description: "Rhizom und Blattbasen sind fest und hellgrün, keine Fäulnis sichtbar."
    }
  ],
  immediateAction: "Sofort auf reines Regen-, Osmose- oder destilliertes Wasser umstellen und mindestens 6 Stunden direkte Sonne bieten."
});

app.post('/api/diagnose', async (req, res) => {
  try {
    const { imageBase64, mimeType = 'image/jpeg' } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'Kein Bild zur Analyse übergeben.' });
    }

    // 1. BASE64-FORMATIERUNG REPARIEREN:
    const base64Data = imageBase64.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');

    // Falls kein API-Key hinterlegt ist, direkt Demo-Fallback liefern
    if (!apiKey) {
      console.warn("Gemini Scan: Kein GEMINI_API_KEY gefunden. Aktiviere Demo-Modus.");
      return res.json(getDemoDiagnosis());
    }

    const systemPrompt = `Du bist ein führender Botaniker und Experte für karnivore Pflanzen (Dionaea muscipula, Drosera, Sarracenia).
Analysiere das übergebene Pflanzenfoto auf folgende drei spezifische Krankheitsbilder:
1. Mineralienverbrennung: Braune, vertrocknete Falle/Blattränder (Hinweis auf falsches Wasser/Leitungswasser mit zu hohem TDS-Wert).
2. Lichtmangel (Etiolement): Verblassend grüne, übermäßig lange Blätter ohne die charakteristische rote Fallen-Ausfärbung.
3. Fäulnis & Pilzbefall: Schwarzer, matschiger Pflanzenteil am Rhizom oder Schimmelbildung durch stehende Nässe bei zu kalter Umgebung.

Antworte AUSSCHLIESSLICH im strikten JSON-Format ohne Markdown-Codeblöcke (kein \`\`\`json):
{
  "plantIdentified": "Gattung und Art (z.B. Dionaea muscipula) oder 'Unbekannt'",
  "vitalityScore": 85,
  "diagnosisSummary": "Eine prägnante Zusammenfassung des Gesamtzustands in 1-2 Sätzen.",
  "issues": [
    {
      "title": "Erkanntes Problem (z.B. Lichtmangel)",
      "severity": "hoch",
      "description": "Kurze Erklärung des Schadbildes"
    }
  ],
  "immediateAction": "Konkrete Sofortmaßnahme (z.B. 'Sofort auf Destilliertes-/Regenwasser umstellen und volle Sonne bieten')."
}`;

    const response = await ai.models.generateContent({
      model: 'gemini-3.8-flash',
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: mimeType || 'image/jpeg',
              data: base64Data,
            },
          },
          {
            text: systemPrompt,
          },
        ],
      },
      config: {
        responseMimeType: 'application/json',
      },
    });

    const responseText = response.text || '';
    const result = extractJson(responseText);

    return res.json(result);
  } catch (error: any) {
    // 3. ERROR LOGGING & DEMO-FALLBACK
    console.error("Gemini Scan Error:", error);
    
    // Anstelle von 500 liefern wir den realistischen Demo-Modus zurück
    return res.json(getDemoDiagnosis());
  }
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static('dist'));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`Carnivora Care server running on http://0.0.0.0:${port}`);
  });
}

startServer();
