"use strict";

const { verifyArticle } = require("./verify-article");
const { verifySources } = require("./verify-sources");

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const TOPICS = ["מדע", "היסטוריה", "ספורט", "פילוסופיה", "טבע"];

function reply(statusCode, data) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(data)
  };
}

async function generate(apiKey, model, topic) {
  const prompt = `כתוב כתבה אחת בעברית לאפליקציית DID YOU KNOW בנושא ${topic}.
בחר סיפור אמיתי ומסקרן. כותרת מדויקת, פתיח קצר וגוף באורך 400 עד 650 מילים בעברית תקינה בלבד.
אל תשתמש באותיות בערבית. אל תמציא עובדות, ציטוטים או כתובות אינטרנט.
צרף 2 עד 4 מקורות אמינים ועצמאיים עם כתובות HTTPS אמיתיות וספציפיות.
החזר JSON בלבד במבנה: {"title":"...","teaser":"...","category":"${topic}","body":"...","sources":[{"name":"...","url":"https://..."}]}`;

  const response = await fetch(`${BASE}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    signal: AbortSignal.timeout(23000),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.5,
        maxOutputTokens: 3500,
        responseMimeType: "application/json"
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${data.error?.message || "Request failed"}`
    );
  }

  const raw = (data.candidates?.[0]?.content?.parts || [])
    .map(p => p.text || "")
    .join("")
    .trim();

  if (!raw) throw new Error("Gemini returned no text");

  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }
}

exports.handler = async event => {
  if (event.httpMethod !== "GET") {
    return reply(405, {
      ok: false,
      error: "Method not allowed"
    });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const secret = process.env.GEMINI_TEST_SECRET;

  if (!apiKey || !secret) {
    return reply(503, {
      ok: false,
      error: "Missing server configuration"
    });
  }

  if ((event.queryStringParameters?.code || "") !== secret) {
    return reply(403, {
      ok: false,
      error: "Forbidden"
    });
  }

  try {
    const response = await fetch(
      `${BASE}/models?pageSize=100`,
      {
        headers: {
          "x-goog-api-key": apiKey
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return reply(502, {
        ok: false,
        error: `Model listing failed (HTTP ${response.status})`,
        published: false
      });
    }

    const available = (data.models || [])
      .filter(m =>
        m.supportedGenerationMethods?.includes("generateContent")
      )
      .map(m => m.name);

    const preferred = [
      "models/gemini-3.5-flash-lite",
      "models/gemini-3-flash",
      "models/gemini-2.5-flash",
      "models/gemini-2.5-flash-lite"
    ];

    const models = [
      ...new Set([
        ...preferred.filter(m => available.includes(m)),
        ...available.filter(m => /flash/i.test(m))
      ])
    ];

    if (!models.length) {
      return reply(503, {
        ok: false,
        error: "No Flash model available",
        published: false
      });
    }

    let lastError = "Generation failed";

    for (const model of models.slice(0, 3)) {
      let article;

      try {
        article = await generate(apiKey, model, TOPICS[0]);
      } catch (error) {
        lastError = error.message || lastError;

        if (/HTTP (400|401|403|429)/.test(lastError)) {
          break;
        }

        continue;
      }

      const quality = verifyArticle(article);

      if (!quality.passed) {
        return reply(200, {
          ok: true,
          model,
          article,
          quality,
          sourceReview: null,
          verification: "QUALITY_FAILED",
          published: false
        });
      }

      const sourceReview = await verifySources(article);

      return reply(200, {
        ok: true,
        model,
        article,
        quality,
        sourceReview,
        verification: "NEEDS_FACT_CHECK",
        published: false
      });
    }

    return reply(502, {
      ok: false,
      error: lastError,
      published: false
    });
  } catch (error) {
    return reply(502, {
      ok: false,
      error:
        error?.name === "TimeoutError"
          ? "Request timed out"
          : "Generation or verification failed",
      published: false
    });
  }
};
