import test from "node:test";
import assert from "node:assert/strict";

import {
  BrowserRecognizer,
  GatewayRecognizer,
  GatewaySpeaker,
  normalizeGatewayTranscript,
  validateSpeechEndpoint
} from "../src/speech.js";

test("browser recognizer returns up to five alternatives", async () => {
  class FakeRecognition {
    start() {
      this.onresult({
        results: [[
          { transcript: "run low", confidence: 0.52 },
          { transcript: "run low on something", confidence: 0.88 }
        ]]
      });
    }
    abort() {}
    stop() {}
  }

  const recognizer = new BrowserRecognizer(FakeRecognition);
  const result = await recognizer.listen({ lang: "en-US" });
  assert.equal(result.transcript, "run low");
  assert.equal(result.alternatives.length, 2);
  assert.equal(result.alternatives[1].transcript, "run low on something");
  assert.equal(recognizer.active, null);
});

test("browser recognizer applies contextual phrase bias when supported", async () => {
  const previousPhrase = globalThis.SpeechRecognitionPhrase;
  class FakePhrase {
    constructor(phrase, boost) {
      this.phrase = phrase;
      this.boost = boost;
    }
  }
  class FakeRecognition {
    constructor() {
      this.phrases = [];
      FakeRecognition.instance = this;
    }
    start() {
      this.onresult({ results: [[{ transcript: "something", confidence: 0.8 }]] });
    }
    abort() {}
    stop() {}
  }

  globalThis.SpeechRecognitionPhrase = FakePhrase;
  try {
    const recognizer = new BrowserRecognizer(FakeRecognition);
    await recognizer.listen({ phrases: ["run low on something"] });
    assert.equal(FakeRecognition.instance.phrases[0].phrase, "run low on something");
    assert.equal(FakeRecognition.instance.phrases[0].boost, 6);
  } finally {
    if (previousPhrase === undefined) delete globalThis.SpeechRecognitionPhrase;
    else globalThis.SpeechRecognitionPhrase = previousPhrase;
  }
});

test("browser recognizer detects and installs on-device language packs", async () => {
  class FakeRecognition {
    static async available(options) {
      assert.deepEqual(options, { langs: ["en-US"], processLocally: true });
      return "downloadable";
    }
    static async install(options) {
      assert.deepEqual(options, { langs: ["en-US"], processLocally: true });
      return true;
    }
  }
  const recognizer = new BrowserRecognizer(FakeRecognition);
  assert.equal(recognizer.supportsOnDevice, true);
  assert.equal(await recognizer.onDeviceAvailability("en-US"), "downloadable");
  assert.equal(await recognizer.installOnDevice("en-US"), true);
});

test("browser recognizer requests local processing when selected", async () => {
  class FakeRecognition {
    constructor() {
      this.processLocally = false;
      FakeRecognition.instance = this;
    }
    start() {
      this.onresult({ results: [[{ transcript: "teacher", confidence: 0.9 }]] });
    }
    abort() {}
    stop() {}
  }
  const recognizer = new BrowserRecognizer(FakeRecognition);
  await recognizer.listen({ processLocally: true });
  assert.equal(FakeRecognition.instance.processLocally, true);
});

test("speech gateway endpoints require HTTPS except on localhost", () => {
  assert.equal(validateSpeechEndpoint("http://127.0.0.1:8787/tts"), "http://127.0.0.1:8787/tts");
  assert.equal(validateSpeechEndpoint("https://speech.example.com/stt"), "https://speech.example.com/stt");
  assert.throws(() => validateSpeechEndpoint("http://speech.example.com/stt"), /必须使用 HTTPS/);
  assert.throws(() => validateSpeechEndpoint("https://key@speech.example.com/stt"), /请勿把账号或密钥/);
});

test("gateway transcript normalization accepts common response shapes", () => {
  assert.deepEqual(normalizeGatewayTranscript({
    text: "run low",
    alternatives: [{ text: "run low on something", confidence: 0.88 }]
  }), {
    transcript: "run low",
    confidence: 0.88,
    alternatives: [
      { transcript: "run low", confidence: null },
      { transcript: "run low on something", confidence: 0.88 }
    ]
  });
});

test("gateway recognizer uploads captured audio with phrases and model", async () => {
  let request;
  const recognizer = new GatewayRecognizer({
    endpoint: "https://speech.example.com/stt",
    model: "child-english",
    token: "temporary-token",
    capture: async () => new Blob(["audio"], { type: "audio/webm" }),
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ transcript: "accept", confidence: 0.91 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    }
  });
  const result = await recognizer.listen({ lang: "en-US", phrases: ["accept", "influence"] });
  assert.equal(result.transcript, "accept");
  assert.equal(request.url, "https://speech.example.com/stt");
  assert.equal(request.options.headers.Authorization, "Bearer temporary-token");
  assert.equal(request.options.body.get("language"), "en-US");
  assert.equal(request.options.body.get("model"), "child-english");
  assert.equal(request.options.body.get("phrases"), '["accept","influence"]');
});

test("gateway speaker sends the Sonemory request and plays returned audio", async () => {
  let payload;
  class FakeAudio {
    play() {
      queueMicrotask(() => this.onended?.());
      return Promise.resolve();
    }
    pause() {}
  }
  const speaker = new GatewaySpeaker({
    endpoint: "https://speech.example.com/tts",
    model: "clear-voice",
    voice: "teacher",
    AudioClass: FakeAudio,
    fetchImpl: async (_url, options) => {
      payload = JSON.parse(options.body);
      return new Response(new Blob(["audio"], { type: "audio/mpeg" }), {
        status: 200,
        headers: { "Content-Type": "audio/mpeg" }
      });
    }
  });
  await speaker.speak("something", { lang: "en-US", rate: 0.9 });
  assert.deepEqual(payload, {
    text: "something",
    language: "en-US",
    rate: 0.9,
    pitch: 1,
    voice: "teacher",
    model: "clear-voice"
  });
});
