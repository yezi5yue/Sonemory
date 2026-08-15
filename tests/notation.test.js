import test from "node:test";
import assert from "node:assert/strict";

import { expandSpeechNotation, speechForms, toSpelling } from "../src/notation.js";

test("dictionary abbreviations are expanded for speech", () => {
  assert.equal(expandSpeechNotation("run low (on sth)"), "run low on something");
  assert.equal(expandSpeechNotation("depend on sb."), "depend on somebody");
});

test("parenthetical dictionary notation produces full and optional forms", () => {
  assert.deepEqual(speechForms("run low (on sth)"), ["run low on something", "run low"]);
});

test("phrase spelling expands notation and preserves word boundaries", () => {
  assert.equal(
    toSpelling("run low (on sth)"),
    "r，u，n；l，o，w；o，n；s，o，m，e，t，h，i，n，g"
  );
});
