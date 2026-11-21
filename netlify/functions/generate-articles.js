
const BASE = "https://generativelanguage.googleapis.com/v1beta";

const TOPICS = [
  "מדע",
  "היסטוריה",
  "ספורט",
  "פילוסופיה",
  "טבע"
];

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

function validUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function validateArticle(article) {
  if (!article || typeof article !== "object" || Array.isArray(article)) {
    return "Invalid article object";
  }

  for (const key of ["title", "teaser", "body", "category"]) {
    if (typeof article[key] !== "string" || !article[key].trim()) {
      return `Missing ${key}`;
    }
  }

  if (!Array.isArray(article.sources) || article.sources.length < 2) {
    return "At least two sources required";
  }

  const sourcesValid = article.sources.every(source =>
    source &&
    typeof source.name === "string" &&
    source.name.trim() &&
    typeof source.url === "string" &&
    validUrl(source.url)
  );

  if (!sourcesValid) {
    return "Invalid source format";
  }

  const words = article.body.trim().split(/\s+/).filter(Boolean).length;

  if (words < 300 || words > 850) {
    return `Article length out of range: ${words} words`;
  }

  return null;
}

async function generate(apiKey, model, topic) {
  const prompt = `
כתוב כתבה אחת בעברית לאפליקציית DID YOU KNOW.

נושא: ${topic}

דרישות:
- בחר סיפור אמיתי, מפתיע ומסקרן.
- כתוב כותרת מעניינת ומדויקת.
- כתוב פתיח קצר שמעורר סקרנות.
- כתוב גוף כתבה באורך 400 עד 700 מילים.
- השתמש בעברית טבעית וברורה.
- אל תמציא עובדות, מחקרים, ציטוטים או תאריכים.
- אם אינך בטוח בעובדה, אל תציג אותה כוודאית.
- הצע 2 עד 4 מקורות עצמאיים ואמינים.
- אל תמציא כתובות אינטרנט.
- החזר JSON תקין בלבד.

מבנה התשובה:
{
  "title": "כותרת",
  "teaser": "פתיח קצר",
  "category": "${topic}",
  "body": "גוף הכתבה",
  "sources": [
    {
      "name": "שם המקור",
      "url": "https://example.org/article"
    }
  ]
}
`;

  const response = await fetch(
    `${BASE}/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey
      },
      signal: AbortSignal.timeout(23000),
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }]
          }
        ],
        generationConfig: {
          temperature: 0.5,
          maxOutputTokens: 3500,
          responseMimeType: "application/json"
        }
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `Gemini HTTP ${response.status}: ${
        data.error?.message || "Request failed"
      }`
    );
  }

  const text = (data.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || "")
    .join("")
    .trim();

  if (!text) {
    throw new Error("Gemini returned no text");
  }

  let article;

  try {
    article = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned invalid JSON");
  }

  const issue = validateArticle(article);

  if (issue) {
    throw new Error(issue);
  }

  return article;
}

exports.handler = async (event) => {
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

  const supplied = event.queryStringParameters?.code || "";

  if (supplied !== secret) {
    return reply(403, {
      ok: false,
      error: "Forbidden"
    });
  }

  try {
    const listResponse = await fetch(
      `${BASE}/models?pageSize=100`,
      {
        headers: {
          "x-goog-api-key": apiKey
        },
        signal: AbortSignal.timeout(8000)
      }
    );

    const listData = await listResponse.json();

    if (!listResponse.ok) {
      return reply(502, {
        ok: false,
        error: `Model listing failed (HTTP ${listResponse.status})`
      });
    }

    const available = (listData.models || [])
      .filter(model =>
        model.supportedGenerationMethods?.includes("generateContent")
      )
      .map(model => model.name);

    const preferred = [
      "models/gemini-3.5-flash-lite",
      "models/gemini-3-flash",
      "models/gemini-2.5-flash",
      "models/gemini-2.5-flash-lite"
    ];

    const models = [
      ...new Set([
        ...preferred.filter(model => available.includes(model)),
        ...available.filter(model => /flash/i.test(model))
      ])
    ];

    if (!models.length) {
      return reply(503, {
        ok: false,
        error: "No Flash model available"
      });
    }

    let lastError = "Unknown error";

    for (const model of models.slice(0, 3)) {
      try {
        const article = await generate(apiKey, model, TOPICS[0]);

        return reply(200, {
          ok: true,
          model,
          article,
          verification: "STRUCTURE_ONLY",
          published: false,
          note: "Facts and source links are not independently verified."
        });

      } catch (error) {
        lastError = error.message || "Generation failed";

        if (/HTTP (400|401|403|429)/.test(lastError)) {
          break;
        }
      }
    }

    return reply(502, {
      ok: false,
      error: lastError,
      published: false
    });

  } catch (error) {
    return reply(502, {
      ok: false,
      error: error?.name === "TimeoutError"
        ? "Request timed out"
        : "Connection failed",
      published: false
    });
  }
};
