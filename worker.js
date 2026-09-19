const json = (data, status = 200, origin = "*") => new Response(JSON.stringify(data), {
  status,
  headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin) },
});

const cors = origin => ({
  "Access-Control-Allow-Origin": origin,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Vary": "Origin",
});

function allowedOrigin(request, env) {
  const origin = request.headers.get("Origin") || "*";
  const configured = (env.ALLOWED_ORIGINS || "").split(",").map(value => value.trim()).filter(Boolean);
  if (!configured.length) return "*";
  return configured.includes(origin) ? origin : "";
}

function isPrivateHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return true;
  const match = host.match(/^172\.(\d{1,3})\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

async function safeFetch(startUrl) {
  let url = new URL(startUrl);
  for (let redirects = 0; redirects < 4; redirects++) {
    if (url.protocol !== "https:" || isPrivateHost(url.hostname)) throw new Error("Lien refusé.");
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "ScanMood/1.0" } });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("Location");
      if (!location) throw new Error("Redirection invalide.");
      url = new URL(location, url); continue;
    }
    return response;
  }
  throw new Error("Trop de redirections.");
}

async function proxyFile(request, env, origin) {
  const body = await request.json();
  if (!body?.url) return json({ error: "Lien manquant." }, 400, origin);
  const upstream = await safeFetch(body.url);
  if (!upstream.ok) return json({ error: "Le document n’est pas accessible." }, 400, origin);
  const type = (upstream.headers.get("Content-Type") || "").split(";")[0].toLowerCase();
  if (!(type.startsWith("image/") || type === "application/pdf")) return json({ error: "Le lien doit pointer vers une image ou un PDF." }, 415, origin);
  const announcedSize = Number(upstream.headers.get("Content-Length") || 0);
  if (announcedSize > 15 * 1024 * 1024) return json({ error: "Le fichier dépasse 15 Mo." }, 413, origin);
  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength > 15 * 1024 * 1024) return json({ error: "Le fichier dépasse 15 Mo." }, 413, origin);
  return new Response(bytes, { headers: { "Content-Type": type, "Cache-Control": "no-store", ...cors(origin) } });
}

function translationPrompt(language, style) {
  const styleRules = {
    faithful: "Be very faithful to the meaning and register, while keeping grammatical French.",
    natural: "Write fluid, idiomatic French that sounds originally written in French while preserving meaning and character voice.",
    adapted: "Adapt idioms, slang, jokes and rhythm boldly into contemporary French while preserving the scene's intent.",
  };
  const languageRule = language === "auto" ? "Detect English, Japanese, Simplified Chinese or Traditional Chinese." : `The source language is ${language}.`;
  return `You are a professional manga, manhwa, comic and scanned-document translator. ${languageRule}
Translate every readable text region into French. ${styleRules[style] || styleRules.natural}
Analyze the whole page before translating: speaker relationships, politeness, sarcasm, tension, humor, slang, narration and previous bubbles on this page. Do not translate each bubble in isolation. Preserve proper names. Keep Japanese honorifics only when they matter to characterization. Adapt sound effects when a natural French equivalent exists.

Return ONLY valid JSON, with this exact shape:
{"detectedLanguage":"english|japanese|chinese","regions":[{"x":0,"y":0,"w":0,"h":0,"original":"","translation":"","kind":"speech|thought|narration|sfx","treatment":"clean|blur"}]}

Coordinates are integers from 0 to 1000 relative to the full image. The rectangle must tightly cover the ORIGINAL LETTERS, with enough surrounding room for the French replacement. Use treatment "clean" for text inside plain speech balloons or simple boxes. Use "blur" only for text printed directly over complex artwork. Return regions in natural reading order. If there is no readable text, return an empty regions array.`;
}

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => part.text || "").join("");
  return "";
}

function parseModelJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.regions)) throw new Error("Format de réponse invalide.");
  return parsed;
}

async function translate(request, env, origin) {
  if (!env.OPENAI_API_KEY) return json({ error: "La clé OPENAI_API_KEY n’est pas configurée sur le service." }, 503, origin);
  const body = await request.json();
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(body?.imageDataUrl || "")) return json({ error: "Image invalide." }, 400, origin);
  if (body.imageDataUrl.length > 14_000_000) return json({ error: "Image trop lourde." }, 413, origin);
  const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.6",
      messages: [{ role: "user", content: [
        { type: "text", text: translationPrompt(body.sourceLanguage, body.style) },
        { type: "image_url", image_url: { url: body.imageDataUrl, detail: "high" } },
      ] }],
      response_format: { type: "json_object" },
    }),
  });
  const payload = await upstream.json();
  if (!upstream.ok) {
    const detail = payload?.error?.message || "Le moteur de traduction n’a pas répondu.";
    return json({ error: detail }, upstream.status >= 500 ? 502 : 400, origin);
  }
  try { return json(parseModelJson(extractContent(payload)), 200, origin); }
  catch { return json({ error: "La traduction reçue n’a pas pu être lue. Réessaie." }, 502, origin); }
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: "Origine non autorisée." }, 403, "null");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/translate") return await translate(request, env, origin);
      if (request.method === "POST" && url.pathname === "/fetch") return await proxyFile(request, env, origin);
      if (url.pathname === "/health") return json({ ok: true }, 200, origin);
      return json({ error: "Route introuvable." }, 404, origin);
    } catch (error) {
      return json({ error: error?.message || "Erreur inattendue." }, 500, origin);
    }
  },
};
