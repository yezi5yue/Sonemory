/*
 * Sonemory - audio-first learning companion.
 * Copyright (C) 2026 yezi5yue and Sonemory contributors.
 * SPDX-License-Identifier: AGPL-3.0-only
 */

export class BrowserSpeaker {
  constructor(synthesis = globalThis.speechSynthesis) {
    this.synthesis = synthesis;
    this.activeResolve = null;
  }

  get supported() {
    return Boolean(this.synthesis && globalThis.SpeechSynthesisUtterance);
  }

  cancel() {
    this.synthesis?.cancel();
    this.activeResolve?.();
    this.activeResolve = null;
  }

  speak(text, { lang = "zh-CN", rate = 1, pitch = 1 } = {}) {
    if (!text) return Promise.resolve();
    if (!this.supported) return Promise.resolve();
    return new Promise((resolve) => {
      this.activeResolve = resolve;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;
      const finish = () => {
        if (this.activeResolve === resolve) this.activeResolve = null;
        resolve();
      };
      utterance.onend = finish;
      utterance.onerror = finish;
      this.synthesis.speak(utterance);
    });
  }

  async speakSegments(segments) {
    for (const segment of segments) {
      await this.speak(segment.text, segment);
    }
  }
}

export class BrowserRecognizer {
  constructor(Recognition = globalThis.SpeechRecognition ?? globalThis.webkitSpeechRecognition) {
    this.Recognition = Recognition;
    this.active = null;
    this.activeResolve = null;
  }

  get supported() {
    return Boolean(this.Recognition);
  }

  abort() {
    try {
      this.active?.abort();
    } catch {
      // The recognition service may already be stopped.
    }
    this.activeResolve?.({ transcript: "", confidence: null, alternatives: [], aborted: true });
    this.active = null;
    this.activeResolve = null;
  }

  listen({ lang = "en-US", timeoutMs = 11000, phrases = [] } = {}) {
    if (!this.supported) {
      return Promise.resolve({ transcript: "", confidence: null, alternatives: [], unsupported: true });
    }
    this.abort();
    return new Promise((resolve) => {
      const recognition = new this.Recognition();
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.active = null;
        this.activeResolve = null;
        resolve(result);
      };
      this.active = recognition;
      this.activeResolve = finish;
      recognition.lang = lang;
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.maxAlternatives = 5;
      const Phrase = globalThis.SpeechRecognitionPhrase;
      if (Phrase && "phrases" in recognition && phrases.length) {
        try {
          recognition.phrases = [...new Set(phrases)]
            .slice(0, 24)
            .map((phrase) => new Phrase(phrase, 6));
        } catch {
          // Contextual bias is experimental and must not block recognition.
        }
      }
      recognition.onresult = (event) => {
        const alternatives = [...(event.results?.[0] ?? [])]
          .map((alternative) => ({
            transcript: alternative?.transcript?.trim() ?? "",
            confidence: Number.isFinite(alternative?.confidence) && alternative.confidence > 0
              ? alternative.confidence
              : null
          }))
          .filter((alternative) => alternative.transcript);
        const best = alternatives[0];
        finish({
          transcript: best?.transcript ?? "",
          confidence: best?.confidence ?? null,
          alternatives
        });
      };
      recognition.onerror = (event) => finish({ transcript: "", confidence: null, alternatives: [], error: event.error });
      recognition.onend = () => finish({ transcript: "", confidence: null, alternatives: [] });
      const timer = setTimeout(() => {
        try { recognition.stop(); } catch { /* no-op */ }
        finish({ transcript: "", confidence: null, alternatives: [], timeout: true });
      }, timeoutMs);
      try {
        recognition.start();
      } catch (error) {
        finish({ transcript: "", confidence: null, alternatives: [], error: error.message });
      }
    });
  }
}

