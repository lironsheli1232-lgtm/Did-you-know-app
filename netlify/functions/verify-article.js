
"use strict";

const MIN_WORDS = 350;
const MAX_WORDS = 750;
const MIN_SOURCES = 2;

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function countWords(value) {
  const text = normalizeText(value);
  return text ? text.split(/\s+/u).filter(Boolean).length : 0;
}

function isPrivateIPv4(hostname) {
  const parts = hostname.split(".");

  if (
    parts.length !== 4 ||
    !parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
  ) {
    return false;
  }

  const [a, b] = parts.map(Number);

  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

function parseSourceUrl(value) {
  if (typeof value !== "string" || value.length > 2048) {
    return null;
  }

  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();

    if (
      url.protocol !== "https:" ||
      !host ||
      url.username ||
      url.password ||
      url.port
    ) {
      return null;
    }

    if (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      host.endsWith(".local") ||
      host.endsWith(".internal") ||
      host.endsWith(".test") ||
      host.endsWith(".invalid")
    ) {
      return null;
    }

    if (host.startsWith("[") || isPrivateIPv4(host)) {
      return null;
    }

    if (!host.includes(".") || !/^[a-z0-9.-]+$/.test(host)) {
      return null;
    }

    return url;
  } catch {
    return null;
  }
}

function verifyArticle(article) {
  const errors = [];
  const warnings = [];

  const metrics = {
    wordCount: 0,
    sourceCount: 0,
    distinctSourceDomains: 0
  };

  if (
    !article ||
    typeof article !== "object" ||
    Array.isArray(article)
  ) {
    return {
      passed: false,
      errors: ["Article must be an object"],
      warnings,
      metrics,
      factChecked: false,
      publicationApproved: false
    };
  }

  for (const field of ["title", "teaser", "category", "body"]) {
    if (!normalizeText(article[field])) {
      errors.push(`Missing or invalid ${field}`);
    }
  }

  const title = normalizeText(article.title);
  const teaser = normalizeText(article.teaser);
  const body = normalizeText(article.body);

  metrics.wordCount = countWords(body);

  if (title.length > 140) {
    warnings.push("Title may be too long");
  }

  if (teaser.length > 350) {
    warnings.push("Teaser may be too long");
  }

  if (
    metrics.wordCount < MIN_WORDS ||
    metrics.wordCount > MAX_WORDS
  ) {
    errors.push(
      `Body must contain ${MIN_WORDS}-${MAX_WORDS} words; got ${metrics.wordCount}`
    );
  }

  if (/[\u0600-\u06ff]/u.test(`${title} ${teaser} ${body}`)) {
    errors.push(
      "Arabic-script characters detected in Hebrew article"
    );
  }

  const sources = Array.isArray(article.sources)
    ? article.sources
    : [];

  metrics.sourceCount = sources.length;

  if (!Array.isArray(article.sources)) {
    errors.push("Sources must be an array");
  }

  if (sources.length < MIN_SOURCES) {
    errors.push(`At least ${MIN_SOURCES} sources required`);
  }

  const urls = new Set();
  const hosts = new Set();

  for (let i = 0; i < sources.length; i++) {
    const source = sources[i];

    if (
      !source ||
      typeof source !== "object" ||
      !normalizeText(source.name)
    ) {
      errors.push(`Source ${i + 1} is missing a name`);
    }

    const url = parseSourceUrl(source?.url);

    if (!url) {
      errors.push(
        `Source ${i + 1} must have a valid public HTTPS URL`
      );
      continue;
    }

    const host = url.hostname.replace(/^www\./, "");

    if (
      /^(example\.(com|org|net)|example\.edu)$/i.test(host)
    ) {
      errors.push(`Placeholder URL at source ${i + 1}`);
    }

    const normalized = url.href.replace(/\/$/, "");

    if (urls.has(normalized)) {
      errors.push(
        `Duplicate source URL at source ${i + 1}`
      );
    }

    urls.add(normalized);
    hosts.add(host);
  }

  metrics.distinctSourceDomains = hosts.size;

  if (sources.length >= 2 && hosts.size < 2) {
    warnings.push(
      "Sources are not from two different domains"
    );
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    metrics,
    factChecked: false,
    publicationApproved: false,
    note:
      "Structure checks only. Links and claims have not been independently verified."
  };
}

module.exports = { verifyArticle };
