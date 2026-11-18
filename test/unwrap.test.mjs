import { test } from "node:test";
import assert from "node:assert/strict";
import { unwrap } from "../no-hard-line-breaks.mjs";

const same = (s) => assert.equal(unwrap(s), s);

test("joins a wrapped paragraph", () => {
  assert.equal(unwrap("One two\nthree four\nfive.\n\nNext\npara.\n"), "One two three four five.\n\nNext para.\n");
});
test("joins list items one by one, with their continuations", () => {
  assert.equal(unwrap("- a b\n  c d\n- e\n  f\n\n1. g\n   h\n"), "- a b c d\n- e f\n\n1. g h\n");
});
test("nested lists and a paragraph inside an item", () => {
  assert.equal(unwrap("- a\n  b\n  - c\n    d\n\n  para\n  more\n"), "- a b\n  - c d\n\n  para more\n");
});
test("keeps hard breaks", () => {
  same("line one  \nline two\\\nline three<br>\nlast\n");
});
test("keeps headings, setext, thematic breaks", () => {
  same("# Title\ntext\n");
  assert.equal(unwrap("Setext\nheading\n===\n"), "Setext heading\n===\n");
  same("para\n---\n");
  same("***\n");
});
test("keeps fenced and indented code", () => {
  same("```js\na\nb\n```\n");
  same("~~~\na\nb\n~~~\n");
  same("text\n\n    code a\n    code b\n\nmore\n");
  same("- item\n\n      code in item\n      more code\n");
});
test("keeps tables, with or without leading pipes", () => {
  same("| a | b |\n| --- | --- |\n| 1 | 2 |\n");
  same("a | b\n--- | ---\n1 | 2\n");
});
test("keeps HTML blocks and comments, and never joins a marker line", () => {
  same("<div>\na\nb\n</div>\n");
  same("<!--\na\nb\n-->\n");
  same("text\n<!-- [admin-area-line] -->\nmore\n");
  same("- [Admin](x) <!-- [admin-area-line] -->\n  next\n");
  same("<details>\n<summary>x</summary>\n\nbody\n</details>\n");
});
test("inline HTML at a line start inside a paragraph is a continuation", () => {
  assert.equal(unwrap("Press\n<kbd>Ctrl</kbd> now\n"), "Press <kbd>Ctrl</kbd> now\n");
});
test("autolink at line start is text", () => {
  assert.equal(unwrap("See\n<https://x.y> now\n"), "See <https://x.y> now\n");
});
test("front matter, link definitions, math, containers", () => {
  same("---\na: 1\nb: 2\n---\n");
  same("[a]: http://x\n[b]: http://y\n");
  same("$$\na\nb\n$$\n");
  same(":::note\na\n:::\n");
});
test("blockquotes join inside, keep the prefix", () => {
  assert.equal(unwrap("> one\n> two\n>\n> three\n"), "> one two\n>\n> three\n");
  same("> a\nlazy\n");
});
test("CRLF and no trailing newline", () => {
  assert.equal(unwrap("a\r\nb\r\n"), "a b\r\n");
  assert.equal(unwrap("a\nb"), "a b");
});
test("touched lines limit the joins to their paragraphs", () => {
  const src = "a\nb\n\nc\nd\n";
  assert.equal(unwrap(src, new Set([4])), "a\nb\n\nc d\n");
});
test("a fence with backticks in its info string is not a fence", () => {
  assert.equal(unwrap("``` a ` b\nc\n"), "``` a ` b c\n");
});
test("labelled fields stay on their own lines; their own continuations join", () => {
  same("1. Claim\n   Observed: x\n   Evidence: y\n");
  same("- **Status:** accepted\n  **Date:** today\n");
  same("Status: done\nOwner: me\n");
  assert.equal(unwrap("Observed: a long\nfinding here\nEvidence: b\n"), "Observed: a long finding here\nEvidence: b\n");
  assert.equal(unwrap("see http://x.y\nand 10:30 here\n"), "see http://x.y and 10:30 here\n");
});
test("a lone 'Word:' line in prose is a wrap, not a field", () => {
  assert.equal(unwrap("Each role includes\nthe ones below it:\n"), "Each role includes the ones below it:\n");
  assert.equal(unwrap("Some text that wraps\nLimits: the address bar\nshows it.\n"), "Some text that wraps Limits: the address bar shows it.\n");
});
test("bold text at a line start is a label only with a colon", () => {
  assert.equal(unwrap("**Activity** (with x) pages\nthrough it. **Sessions** lists\n**Other** things.\n"), "**Activity** (with x) pages through it. **Sessions** lists **Other** things.\n");
});
test("block syntax inside a list item is relative to its content column", () => {
  same("1. Run it:\n\n    ```\n    Token created\n      id : x\n    ```\n\n2. Next\n");
  same("- item\n\n      # not a heading? still code-ish\n");
  same("1. a\n\n    <div>\n    x\n    y\n    </div>\n");
  same("- a\n\n  ## Heading in item\n  text\n");
});
