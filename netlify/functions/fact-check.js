
"use strict";
in
// AI-assisted review. Never automatically approves publication.
const BASE = "https://generativelanguage.googleapis.com/v1beta";

function pending(reason) {
  return {
    status: "NEEDS_FACT_CHECK",
    factChecked: false,
    publicationApproved: false,
    reason,
    claims: []
  };
}

async function factCheck(
  article,
  sourceReview,
  apiKey,
  model = "models/gemini-3.5-flash-lite"
) {
  if (!article || typeof article.body !== "string" ||
      !article.body.trim()) {
    return pending("Missing article text");
  }

  if (!apiKey || typeof apiKey !== "string") {
    return pending("Missing API key");
  }

  const sources = (sourceReview?.sources || [])
    .filter(s => {
      const excerpt = s?.excerpt || s?.text;
      return typeof excerpt === "string" &&
        excerpt.trim().length > 100;
    })
    .slice(0, 3);

  if (sources.length < 2) {
    return pending("Fewer than two readable sources");
  }

  const evidence = sources.map((s, i) => ({
    id: i + 1,
    url: String(s.url || "").slice(0, 500),
    excerpt: String(s.excerpt || s.text).slice(0, 3500)
  }));

  const prompt = [
    "You are a strict Hebrew-language fact-checking assistant.",
    "Use ONLY the provided source excerpts.",
    "Do not use prior knowledge.",
    "Identify up to 8 important factual claims in the article.",
    "For each claim choose one verdict:",
    "supported, contradicted, insufficient_evidence.",
    "Mark supported only when the excerpt explicitly supports",
    "the exact claim, including dates and numbers.",
    "Return JSON only in this structure:",
    '{"claims":[{"claim":"...","verdict":"supported",' +
      '"sourceIds":[1],"explanation":"..."}]}',
    "Article:",
    article.body.slice(0, 12000),
    "Source excerpts:",
    JSON.stringify(evidence)
  ].join("\n");

  try {
    const response = await fetch(
      `${BASE}/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        signal: AbortSignal.timeout(18000),
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2200,
            responseMimeType: "application/json"
          }
        })
      }
    );

    if (!response.ok) {
      return pending(`AI review failed (HTTP ${response.status})`);
    }

    const data = await response.json();

    const raw = (
      data.candidates?.[0]?.content?.parts || []
    ).map(p => p.text || "").join("");

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed.claims) ||
        !parsed.claims.length) {
      return pending("No factual claims reviewed");
    }

    const allowed = new Set([
      "supported",
      "contradicted",
      "insufficient_evidence"
    ]);

    const claims = parsed.claims.slice(0, 8).map(c => ({
      claim: String(c.claim || "").slice(0, 500),
      verdict: allowed.has(c.verdict)
        ? c.verdict
        : "insufficient_evidence",
      sourceIds: Array.isArray(c.sourceIds)
        ? c.sourceIds.filter(id =>
            Number.isInteger(id) &&
            id >= 1 &&
            id <= evidence.length
          )
        : [],
      explanation: String(c.explanation || "").slice(0, 600)
    }));

    return {
      status: "REVIEW_COMPLETED",
      factChecked: false,
      publicationApproved: false,
      claims,
      supportedCount: claims.filter(c =>
        c.verdict === "supported" &&
        c.sourceIds.length > 0
      ).length,
      flaggedCount: claims.filter(c =>
        c.verdict !== "supported" ||
        c.sourceIds.length === 0
      ).length,
      note: "AI assessment of limited excerpts only"
    };

  } catch {
    return pending("AI review could not be completed");
  }
}

module.exports = { factCheck };
