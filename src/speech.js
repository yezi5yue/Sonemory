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
    this.availabilityCache = new Map();
  }

  get supported() {
    return Boolean(this.Recognition);
  }

  get supportsOnDevice() {
    return Boolean(this.Recognition?.available && this.Recognition?.install);
  }

  async onDeviceAvailability(lang, { refresh = false } = {}) {
    if (!this.supportsOnDevice) return "unsupported";
    if (!refresh && this.availabilityCache.has(lang)) return this.availabilityCache.get(lang);
    try {
      const availability = await this.Recognition.available({ langs: [lang], processLocally: true });
      this.availabilityCache.set(lang, availability);
      return availability;
    } catch {
      return "unsupported";
    }
  }

  async installOnDevice(lang) {
    if (!this.supportsOnDevice) return false;
    try {
      const installed = Boolean(await this.Recognition.install({ langs: [lang], processLocally: true }));
      if (installed) this.availabilityCache.set(lang, "available");
      return installed;
    } catch {
      return false;
    }
  }

  async shouldProcessLocally(lang, mode = "auto-local") {
    if (mode === "browser-service") return false;
    return (await this.onDeviceAvailability(lang)) === "available";
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

  listen({ lang = "en-US", timeoutMs = 11000, phrases = [], processLocally = false } = {}) {
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
      if ("processLocally" in recognition) recognition.processLocally = Boolean(processLocally);
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

export async function diagnoseMicrophone(mediaDevices = globalThis.navigator?.mediaDevices) {
  if (!mediaDevices?.getUserMedia) {
    return {
      status: "unsupported",
      message: "当前浏览器不能执行麦克风自检。",
      speech: "当前浏览器不能执行麦克风自检。"
    };
  }
  let stream;
  try {
    stream = await mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
    });
    const tracks = stream.getAudioTracks?.() ?? [];
    const ready = tracks.some((track) => track.readyState === "live" && track.enabled !== false);
    if (!ready) {
      return {
        status: "unavailable",
        message: "没有找到可用的麦克风音轨。",
        speech: "没有找到可用的麦克风。"
      };
    }
    const label = tracks.find((track) => track.label)?.label ?? "系统默认麦克风";
    return {
      status: "ready",
      message: `麦克风可访问：${label}。自检只能确认设备和权限，不能保证识别准确率。`,
      speech: "麦克风和权限正常，但仍可能受距离、噪声或识别服务影响。"
    };
  } catch (error) {
    const denied = ["NotAllowedError", "SecurityError"].includes(error?.name);
    return {
      status: denied ? "denied" : "unavailable",
      message: denied ? "麦克风权限未开启，请由家长在浏览器中允许麦克风。" : "麦克风暂时不可用，请检查设备连接。",
      speech: denied ? "麦克风权限没有开启，请找家长帮忙。" : "麦克风暂时不可用。"
    };
  } finally {
    stream?.getTracks?.().forEach((track) => track.stop());
  }
}

export function validateSpeechEndpoint(value) {
  const input = String(value ?? "").trim();
  if (!input) return "";
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("语音端点必须是完整的 HTTP(S) 地址。");
  }
  if (url.username || url.password) throw new Error("请勿把账号或密钥写入语音端点地址。");
  const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && localHosts.has(url.hostname))) {
    throw new Error("远程语音端点必须使用 HTTPS；HTTP 仅允许本机地址。");
  }
  return url.href;
}

function bearerHeaders(token) {
  const value = String(token ?? "").trim();
  return value ? { Authorization: `Bearer ${value}` } : {};
}

function finiteConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeGatewayTranscript(data = {}) {
  const alternatives = (Array.isArray(data.alternatives) ? data.alternatives : [])
    .map((item) => typeof item === "string"
      ? { transcript: item.trim(), confidence: null }
      : {
          transcript: String(item?.transcript ?? item?.text ?? "").trim(),
          confidence: finiteConfidence(item?.confidence)
        })
    .filter((item) => item.transcript);
  const transcript = String(data.transcript ?? data.text ?? alternatives[0]?.transcript ?? "").trim();
  const confidence = finiteConfidence(data.confidence)
    ?? alternatives.find((item) => item.confidence !== null)?.confidence
    ?? null;
  if (transcript && !alternatives.some((item) => item.transcript === transcript)) {
    alternatives.unshift({ transcript, confidence: finiteConfidence(data.confidence) });
  }
  return {
    transcript,
    confidence,
    alternatives
  };
}

function dataUrlToBlob(base64, mimeType = "audio/mpeg") {
  const binary = globalThis.atob(String(base64));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

export class GatewaySpeaker {
  constructor({ endpoint = "", model = "", voice = "", token = "", fetchImpl = globalThis.fetch, AudioClass = globalThis.Audio } = {}) {
    this.endpoint = validateSpeechEndpoint(endpoint);
    this.model = String(model ?? "").trim();
    this.voice = String(voice ?? "").trim();
    this.token = String(token ?? "").trim();
    this.fetchImpl = fetchImpl;
    this.AudioClass = AudioClass;
    this.activeAbort = null;
    this.activeAudio = null;
    this.activeResolve = null;
    this.objectUrl = null;
  }

  get supported() {
    return Boolean(this.endpoint && this.fetchImpl && this.AudioClass);
  }

  cancel() {
    this.activeAbort?.abort();
    this.activeAudio?.pause?.();
    this.activeResolve?.();
    this.activeAbort = null;
    this.activeAudio = null;
    this.activeResolve = null;
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
  }

  async speak(text, { lang = "zh-CN", rate = 1, pitch = 1 } = {}) {
    if (!text) return;
    if (!this.supported) throw new Error("AI 语音合成端点尚未正确配置。");
    this.cancel();
    const abort = new AbortController();
    this.activeAbort = abort;
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/*, application/json",
          "X-Sonemory-Speech-Protocol": "1",
          ...bearerHeaders(this.token)
        },
        body: JSON.stringify({ text, language: lang, rate, pitch, voice: this.voice, model: this.model }),
        signal: abort.signal
      });
      if (!response.ok) throw new Error(`AI 语音合成失败（HTTP ${response.status}）。`);
      const contentType = response.headers.get("content-type") ?? "";
      let audioBlob;
      if (contentType.includes("application/json")) {
        const payload = await response.json();
        if (!payload.audioBase64 && !payload.audio) throw new Error("AI 语音端点没有返回音频数据。");
        audioBlob = dataUrlToBlob(payload.audioBase64 ?? payload.audio, payload.mimeType ?? "audio/mpeg");
      } else {
        audioBlob = await response.blob();
      }
      if (abort.signal.aborted) return;
      this.objectUrl = URL.createObjectURL(audioBlob);
      const audio = new this.AudioClass(this.objectUrl);
      this.activeAudio = audio;
      await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (error = null) => {
          if (settled) return;
          settled = true;
          this.activeResolve = null;
          audio.onended = null;
          audio.onerror = null;
          if (error) reject(error);
          else resolve();
        };
        this.activeResolve = () => finish();
        audio.onended = () => finish();
        audio.onerror = () => finish(new Error("浏览器无法播放 AI 语音端点返回的音频。"));
        Promise.resolve(audio.play()).catch((error) => finish(error));
      });
    } catch (error) {
      if (error?.name !== "AbortError") throw error;
    } finally {
      if (this.activeAbort === abort) {
        this.activeAbort = null;
        this.activeAudio = null;
        this.activeResolve = null;
        if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
        this.objectUrl = null;
      }
    }
  }

  async speakSegments(segments) {
    for (const segment of segments) await this.speak(segment.text, segment);
  }
}

export async function captureSpeechAudio({
  timeoutMs = 10000,
  signal,
  mediaDevices = globalThis.navigator?.mediaDevices,
  MediaRecorderClass = globalThis.MediaRecorder,
  AudioContextClass = globalThis.AudioContext ?? globalThis.webkitAudioContext
} = {}) {
  if (!mediaDevices?.getUserMedia || !MediaRecorderClass) throw new Error("当前浏览器无法录制语音。");
  const stream = await mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }
  });
  if (signal?.aborted) {
    stream.getTracks().forEach((track) => track.stop());
    const error = new Error("录音已中断。");
    error.name = "AbortError";
    throw error;
  }
  const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
    .find((type) => MediaRecorderClass.isTypeSupported?.(type));
  const recorder = new MediaRecorderClass(stream, mimeType ? { mimeType } : undefined);
  const chunks = [];
  let audioContext = null;
  let monitorTimer = null;
  let hardTimer = null;
  let speechStarted = false;
  let lastVoiceAt = performance.now();
  let analyser = null;
  let samples = null;

  if (AudioContextClass) {
    try {
      audioContext = new AudioContextClass();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      samples = new Float32Array(analyser.fftSize);
      source.connect(analyser);
    } catch {
      audioContext = null;
    }
  }

  const cleanup = () => {
    clearInterval(monitorTimer);
    clearTimeout(hardTimer);
    stream.getTracks().forEach((track) => track.stop());
    void audioContext?.close?.();
  };
  const stop = () => {
    if (recorder.state !== "inactive") recorder.stop();
  };
  const onAbort = () => stop();
  signal?.addEventListener("abort", onAbort, { once: true });

  return new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = (event) => {
      cleanup();
      reject(new Error(event.error?.message ?? "录音失败。"));
    };
    recorder.onstop = () => {
      cleanup();
      signal?.removeEventListener("abort", onAbort);
      resolve(new Blob(chunks, { type: recorder.mimeType || "audio/webm" }));
    };
    recorder.start(160);
    hardTimer = setTimeout(stop, timeoutMs);
    if (analyser && samples) {
      monitorTimer = setInterval(() => {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
        const now = performance.now();
        if (rms >= 0.025) {
          speechStarted = true;
          lastVoiceAt = now;
        } else if (speechStarted && now - lastVoiceAt >= 850) {
          stop();
        }
      }, 60);
    }
  });
}

export class GatewayRecognizer {
  constructor({ endpoint = "", model = "", token = "", fetchImpl = globalThis.fetch, capture = captureSpeechAudio } = {}) {
    this.endpoint = validateSpeechEndpoint(endpoint);
    this.model = String(model ?? "").trim();
    this.token = String(token ?? "").trim();
    this.fetchImpl = fetchImpl;
    this.capture = capture;
    this.usesBrowserCapture = capture === captureSpeechAudio;
    this.activeAbort = null;
  }

  get supported() {
    const captureSupported = !this.usesBrowserCapture
      || Boolean(globalThis.navigator?.mediaDevices?.getUserMedia && globalThis.MediaRecorder);
    return Boolean(this.endpoint && this.fetchImpl && this.capture && captureSupported);
  }

  abort() {
    this.activeAbort?.abort();
    this.activeAbort = null;
  }

  async listen({ lang = "en-US", timeoutMs = 10000, phrases = [] } = {}) {
    if (!this.supported) return { transcript: "", confidence: null, alternatives: [], unsupported: true };
    this.abort();
    const abort = new AbortController();
    this.activeAbort = abort;
    try {
      const audio = await this.capture({ timeoutMs, signal: abort.signal });
      if (abort.signal.aborted) return { transcript: "", confidence: null, alternatives: [], aborted: true };
      const body = new FormData();
      body.append("audio", audio, audio.type.includes("ogg") ? "speech.ogg" : "speech.webm");
      body.append("language", lang);
      body.append("model", this.model);
      body.append("phrases", JSON.stringify([...new Set(phrases)].slice(0, 48)));
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "X-Sonemory-Speech-Protocol": "1", ...bearerHeaders(this.token) },
        body,
        signal: abort.signal
      });
      if (!response.ok) throw new Error(`AI 语音识别失败（HTTP ${response.status}）。`);
      return normalizeGatewayTranscript(await response.json());
    } catch (error) {
      if (error?.name === "AbortError") return { transcript: "", confidence: null, alternatives: [], aborted: true };
      return { transcript: "", confidence: null, alternatives: [], error: error.message };
    } finally {
      if (this.activeAbort === abort) this.activeAbort = null;
    }
  }
}

