
"use strict";

// Collect source evidence without approving factual claims.

const TRUSTED_HOSTS = new Set([
  "nobelprize.org",
  "science.org.au",
  "nasa.gov",
  "noaa.gov",
  "nih.gov",
  "ncbi.nlm.nih.gov",
  "who.int",
  "britannica.com",
  "smithsonianmag.com",
  "si.edu",
  "nature.com",
  "science.org",
  "history.com",
  "olympics.com",
  "fifa.com",
  "un.org",
  "unesco.org",
  "nationalgeographic.com",
  "royalsociety.org"
]);

function approvedUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    return null;
  }

  try {
    const url = new URL(value);

    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    const host = url.hostname.toLowerCase().replace(/\.$/, "");

    const approved = [...TRUSTED_HOSTS].some(
      domain => host === domain || host.endsWith("." + domain)
    );

    return approved ? url : null;
  } catch {
    return null;
  }
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function extractText(html) {
  return decodeEntities(
    html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  ).slice(0, 4500);
}

async function fetchEvidence(source, fetchImpl) {
  const url = approvedUrl(source?.url);

  if (!url) {
    return {
      name: source?.name || "",
      url: source?.url || "",
      status: "not_checked",
      reason: "Domain not on review allowlist"
    };
  }

  try {
    const response = await fetchImpl(url.href, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        Accept: "text/html, text/plain;q=0.9"
      }
    });

    if (response.status >= 300 && response.status < 400) {
      return {
        name: source.name,
        url: url.href,
        status: "not_checked",
        reason: "Redirect requires manual review"
      };
    }

    if (!response.ok) {
      return {
        name: source.name,
        url: url.href,
        status: "unavailable",
        httpStatus: response.status
      };
    }

    const type = response.headers.get("content-type") || "";

    if (!/^text\/(html|plain)\b/i.test(type)) {
      return {
        name: source.name,
        url: url.href,
        status: "not_checked",
        reason: "Unsupported content type"
      };
    }

    const length = Number(
      response.headers.get("content-length") || 0
    );

    if (length > 120000) {
      return {
        name: source.name,
        url: url.href,
        status: "not_checked",
        reason: "Page too large"
      };
    }

    if (
      !response.body ||
      typeof response.body.getReader !== "function"
    ) {
      return {
        name: source.name,
        url: url.href,
        status: "unavailable",
        reason: "No readable response body"
      };
    }

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        total += value.byteLength;

        if (total > 120000) {
          await reader.cancel();

          return {
            name: source.name,
            url: url.href,
            status: "not_checked",
            reason: "Page too large"
          };
        }

        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;

    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const decoded = new TextDecoder().decode(bytes);

    const text = /^text\/html/i.test(type)
      ? extractText(decoded)
      : decoded.replace(/\s+/g, " ").trim().slice(0, 4500);

    if (text.length < 150) {
      return {
        name: source.name,
        url: url.href,
        status: "not_checked",
        reason: "Insufficient readable text"
      };
    }

    return {
      name: source.name,
      url: url.href,
      status: "retrieved",
      excerpt: text.slice(0, 1800)
    };
  } catch {
    return {
      name: source.name,
      url: url.href,
      status: "unavailable",
      reason: "Request failed or timed out"
    };
  }
}

async function verifySources(article, options = {}) {
  const sources = Array.isArray(article?.sources)
    ? article.sources.slice(0, 4)
    : [];

  const fetchImpl = options.fetchImpl || fetch;
  const results = [];

  for (const source of sources) {
    results.push(await fetchEvidence(source, fetchImpl));
  }

  return {
    status: "NEEDS_FACT_CHECK",
    publicationApproved: false,
    factChecked: false,
    sources: results,
    retrievedCount: results.filter(
      source => source.status === "retrieved"
    ).length,
    note:
      "Retrieved text is untrusted evidence, not proof of article claims. A separate claim-by-claim review is required."
  };
}

module.exports = { verifySources };
