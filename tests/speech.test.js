import test from "node:test";
import assert from "node:assert/strict";

import { BrowserRecognizer } from "../src/speech.js";

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
