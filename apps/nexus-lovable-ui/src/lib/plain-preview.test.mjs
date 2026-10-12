import assert from "node:assert/strict";
import { plainPreview } from "./plain-preview.ts";
assert.equal(plainPreview("# Agenda\n- [ ] Book venue\n- **Budget** [sheet](https://x)"), "Agenda · Book venue · Budget sheet");
assert.equal(plainPreview("> quoted _text_ and `code`\n\n---\n1. one"), "quoted text and code · one");
assert.equal(plainPreview("| a | b |\n|---|---|\n| 1 | 2 |"), "a · b · 1 · 2");
assert.equal(plainPreview(""), "");
assert.equal(plainPreview("snake_case_name stays"), "snake_case_name stays");
console.log("plain-preview ok");
