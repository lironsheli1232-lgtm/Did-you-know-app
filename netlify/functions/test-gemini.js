
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
    return reply(405, {
      ok: false,
      error: "Method not allowed"
    });
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
    const listResponse = await fetch(
      `${BASE}/models?key=${encodeURIComponent(apiKey)}&pageSize=100`,
      {
        signal: AbortSignal.timeout(12000)
      }
    );

    const listData = await listResponse.json();

    if (!listResponse.ok) {
      return reply(502, {
        ok: false,
        stage: "listModels",
        error: listData.error?.message || `HTTP ${listResponse.status}`
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
      "models/gemini-2.5-flash-lite",
      "models/gemini-2.0-flash"
    ];

    const candidates = [
      ...preferred.filter(name => available.includes(name)),
      ...available.filter(name => /flash/i.test(name))
    ].filter((name, index, array) => array.indexOf(name) === index);

    if (!candidates.length) {
      return reply(503, {
        ok: false,
        error: "No compatible Flash models available"
      });
    }

    const errors = [];

    for (const model of candidates.slice(0, 5)) {
      try {
        const response = await fetch(
          `${BASE}/${model}:generateContent`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-goog-api-key": apiKey
            },
            signal: AbortSignal.timeout(20000),
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: "כתוב משפט אחד בעברית על עובדה מדעית ידועה."
                }]
              }],
              generationConfig: {
                maxOutputTokens: 300
              }
            })
          }
        );

        const data = await response.json();

        if (!response.ok) {
          errors.push({
            model,
            status: response.status,
            error: data.error?.message || "Request failed"
          });

          if ([400, 403, 429].includes(response.status)) {
            break;
          }

          continue;
        }

        const text = (data.candidates?.[0]?.content?.parts || [])
          .map(part => part.text || "")
          .join("")
          .trim();

        if (!text) {
          errors.push({
            model,
            error: "No text returned"
          });
          continue;
        }

        return reply(200, {
          ok: true,
          model,
          text
        });

      } catch (error) {
        errors.push({
          model,
          error: error?.name === "TimeoutError"
            ? "Request timed out"
            : "Connection failed"
        });
      }
    }

    return reply(502, {
      ok: false,
      error: "All tested models failed",
      attempts: errors
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
