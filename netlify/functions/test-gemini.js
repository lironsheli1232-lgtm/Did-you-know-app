
const BASE = "https://generativelanguage.googleapis.com/v1beta";

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

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return reply(405, { ok: false, error: "Method not allowed" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  const testSecret = process.env.GEMINI_TEST_SECRET;

  if (!apiKey || !testSecret) {
    return reply(503, {
      ok: false,
      error: "Server configuration missing"
    });
  }

  const supplied = event.queryStringParameters?.code || "";

  if (supplied !== testSecret) {
    return reply(403, {
      ok: false,
      error: "Forbidden"
    });
  }

  try {
    const list = await fetch(
      `${BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=100`,
      { signal: AbortSignal.timeout(12000) }
    );

    const modelsData = await list.json();

    if (!list.ok) {
      return reply(502, {
        ok: false,
        stage: "listModels",
        error: modelsData.error?.message || `HTTP ${list.status}`
      });
    }

    const available = (modelsData.models || [])
      .filter(m =>
        m.supportedGenerationMethods?.includes("generateContent")
      )
      .map(m => m.name);

    const preferred = [
      "models/gemini-2.5-flash-lite",
      "models/gemini-2.5-flash",
      "models/gemini-2.0-flash-lite",
      "models/gemini-2.0-flash"
    ];

    const selected =
      preferred.find(name => available.includes(name)) ||
      available.find(name => /flash/i.test(name));

    if (!selected) {
      return reply(503, {
        ok: false,
        error: "No compatible Flash model available"
      });
    }

    const response = await fetch(
      `${BASE}/${selected}:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        signal: AbortSignal.timeout(25000),
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: "כתוב משפט אחד בעברית על עובדה מדעית ידועה."
            }]
          }],
          generationConfig: {
            maxOutputTokens: 180
          }
        })
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return reply(502, {
        ok: false,
        model: selected,
        error: data.error?.message || `HTTP ${response.status}`
      });
    }

    const text = (data.candidates?.[0]?.content?.parts || [])
      .map(part => part.text || "")
      .join("")
      .trim();

    if (!text) {
      return reply(502, {
        ok: false,
        model: selected,
        error: "No text returned"
      });
    }

    return reply(200, {
      ok: true,
      model: selected,
      text
    });

  } catch (error) {
    return reply(502, {
      ok: false,
      error: error?.name === "TimeoutError"
        ? "Gemini request timed out"
        : "Gemini connection failed"
    });
  }
};
