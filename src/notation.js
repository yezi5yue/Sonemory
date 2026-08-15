/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

const ABBREVIATIONS = [
  [/\bsth\b\.?/gi, "something"],
  [/\bsb\b\.?/gi, "somebody"]
];

export function expandSpeechNotation(value) {
  let expanded = String(value ?? "").normalize("NFKC");
  for (const [pattern, replacement] of ABBREVIATIONS) {
    expanded = expanded.replace(pattern, replacement);
  }
  return expanded
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function speechForms(value) {
  const source = String(value ?? "").trim();
  const fullForm = expandSpeechNotation(source);
  const optionalRemoved = expandSpeechNotation(source.replace(/\s*\([^)]*\)/g, " "));
  return [...new Set([fullForm, optionalRemoved].filter(Boolean))];
}

export function toSpelling(value) {
  return expandSpeechNotation(value)
    .split(/[\s-]+/)
    .map((word) => [...word.replace(/[^a-z]/gi, "")].join("，"))
    .filter(Boolean)
    .join("；");
}
