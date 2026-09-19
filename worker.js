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
  if (typeof payload?.response === "string") return payload.response;
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map(part => part.text || "").join("");
  return "";
}

function parseModelJson(text) {
  const raw = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const cleaned = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed.regions)) throw new Error("Format de réponse invalide.");
  return parsed;
}

function imageBytes(dataUrl) {
  const base64 = dataUrl.split(",", 2)[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function translate(request, env, origin) {
  if (!env.AI) return json({ error: "Le moteur Workers AI n’est pas relié à ce Worker." }, 503, origin);
  const body = await request.json();
  if (!/^data:image\/(jpeg|png|webp);base64,/i.test(body?.imageDataUrl || "")) return json({ error: "Image invalide." }, 400, origin);
  if (body.imageDataUrl.length > 14_000_000) return json({ error: "Image trop lourde." }, 413, origin);
  try {
    const payload = await env.AI.run(env.AI_MODEL || "@cf/google/gemma-4-26b-a4b-it", {
      messages: [{
        role: "user",
        content: [
          { type: "text", text: translationPrompt(body.sourceLanguage, body.style) },
          { type: "image_url", image_url: { url: body.imageDataUrl } },
        ],
      }],
      temperature: 0.15,
      max_completion_tokens: 4096,
      response_format: { type: "json_object" },
      chat_template_kwargs: { enable_thinking: false },
    });
    return json(parseModelJson(extractContent(payload)), 200, origin);
  } catch (error) {
    const detail = String(error?.message || error || "");
    if (/quota|daily free allocation|neurons|usage limit/i.test(detail)) {
      return json({ error: "La limite gratuite du jour est atteinte. Réessaie demain." }, 429, origin);
    }

    // Compatibilité de secours pour les modèles vision qui attendent les octets bruts.
    try {
      const payload = await env.AI.run(env.AI_FALLBACK_MODEL || "@cf/llava-hf/llava-1.5-7b-hf", {
        image: [...imageBytes(body.imageDataUrl)],
        prompt: translationPrompt(body.sourceLanguage, body.style),
        max_tokens: 4096,
        temperature: 0.15,
      });
      return json(parseModelJson(extractContent(payload)), 200, origin);
    } catch (fallbackError) {
      const fallbackDetail = String(fallbackError?.message || fallbackError || detail);
      if (/quota|daily free allocation|neurons|usage limit/i.test(fallbackDetail)) {
        return json({ error: "La limite gratuite du jour est atteinte. Réessaie demain." }, 429, origin);
      }
      return json({ error: "Le moteur gratuit n’a pas réussi à lire cette page. Essaie une image plus nette." }, 502, origin);
    }
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return json({ ok: true, engine: "cloudflare-workers-ai", free: true }, 200, "*");
    }
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ error: "Origine non autorisée." }, 403, "null");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
    try {
      if (request.method === "POST" && url.pathname === "/translate") return await translate(request, env, origin);
      if (request.method === "POST" && url.pathname === "/fetch") return await proxyFile(request, env, origin);
      return json({ error: "Route introuvable." }, 404, origin);
    } catch (error) {
      return json({ error: error?.message || "Erreur inattendue." }, 500, origin);
    }
  },
};
