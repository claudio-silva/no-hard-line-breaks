// The installer and the project's linters. Each test names the complaint it prevents: after the hook is installed, a
// rule that limits or wraps Markdown lines must be off, and what the installer cannot change must be said, not guessed.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { REMINDER, settleLinters } from "../linters.mjs";

const here = dirname(fileURLToPath(import.meta.url));

/** A scratch project holding the given files; returns helpers to settle it and read it back. */
function project(files) {
	const root = mkdtempSync(join(tmpdir(), "nhlb-"));
	for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
	return {
		root,
		settle: () => settleLinters(root),
		text: (name) => readFileSync(join(root, name), "utf8"),
		json: (name) => JSON.parse(readFileSync(join(root, name), "utf8")),
		has: (name) => existsSync(join(root, name)),
	};
}

test("a project with no linter is left alone", () => {
	const p = project({ "package.json": { name: "x", devDependencies: { vitest: "1" } } });
	assert.deepEqual(p.settle(), { changed: [], notes: [] });
});

test("markdownlint: MD013 is turned off in a JSON configuration, whatever limit it had", () => {
	const p = project({ ".markdownlint.json": { default: true, MD013: { line_length: 120 }, MD033: false } });
	assert.deepEqual(p.settle().changed, [".markdownlint.json"]);
	assert.deepEqual(p.json(".markdownlint.json"), { default: true, MD013: false, MD033: false });
});

test("markdownlint: the rule's alias counts, and a configuration that is already off is not rewritten", () => {
	const p = project({ ".markdownlint.json": '{"line-length":false}' });
	assert.deepEqual(p.settle(), { changed: [], notes: [] });
	assert.equal(p.text(".markdownlint.json"), '{"line-length":false}');
});

test("markdownlint: used with no configuration (MD013 is on by default), one is created", () => {
	const p = project({ "package.json": { devDependencies: { "markdownlint-cli2": "1" } } });
	assert.deepEqual(p.settle().changed, [".markdownlint.json"]);
	assert.deepEqual(p.json(".markdownlint.json"), { MD013: false });
});

test("markdownlint: a YAML configuration gets the key appended, and keeps the rest", () => {
	const p = project({ ".markdownlint.yaml": "default: true\nMD033: false" });
	p.settle();
	assert.match(p.text(".markdownlint.yaml"), /^default: true\nMD033: false\n#.*\nMD013: false\n$/);
});

test("markdownlint: a YAML limit spread over lines, and JSON with comments, are reported and not edited", () => {
	const yaml = "MD013:\n  line_length: 100\n";
	const jsonc = '{\n  // our style\n  "MD013": { "line_length": 100 }\n}\n';
	const p = project({ ".markdownlint.yml": yaml, ".markdownlint-cli2.jsonc": jsonc });
	const { changed, notes } = p.settle();
	assert.deepEqual(changed, []);
	assert.equal(notes.length, 2);
	assert.ok(notes.every((n) => n.includes("MD013")));
	assert.equal(p.text(".markdownlint.yml"), yaml);
	assert.equal(p.text(".markdownlint-cli2.jsonc"), jsonc);
});

test("markdownlint-cli2: its rules are under config", () => {
	const p = project({ ".markdownlint-cli2.jsonc": { globs: ["**/*.md"], config: { MD013: { line_length: 100 } } } });
	p.settle();
	assert.deepEqual(p.json(".markdownlint-cli2.jsonc"), { globs: ["**/*.md"], config: { MD013: false } });
});

test("Prettier: proseWrap always becomes preserve, in overrides too; never and preserve stay", () => {
	const p = project({
		".prettierrc": { printWidth: 100, proseWrap: "always", overrides: [{ files: "*.md", options: { proseWrap: "always" } }] },
		"package.json": { name: "x", prettier: { proseWrap: "never" } },
	});
	assert.deepEqual(p.settle().changed, [".prettierrc"]);
	assert.deepEqual(p.json(".prettierrc"), { printWidth: 100, proseWrap: "preserve", overrides: [{ files: "*.md", options: { proseWrap: "preserve" } }] });
});

test("Prettier: the package.json key is settled, and a JavaScript configuration is reported", () => {
	const p = project({ "package.json": { name: "x", prettier: { proseWrap: "always" } }, "prettier.config.mjs": 'export default { proseWrap: "always" };\n' });
	const { changed, notes } = p.settle();
	assert.deepEqual(changed, ["package.json"]);
	assert.equal(p.json("package.json").prettier.proseWrap, "preserve");
	assert.equal(notes.length, 1);
	assert.match(notes[0], /^prettier\.config\.mjs: .*proseWrap/);
});

test("EditorConfig: a line limit that reaches Markdown is switched off for Markdown only, once", () => {
	const before = "root = true\n\n[*]\nindent_style = tab\nmax_line_length = 100\n";
	const p = project({ ".editorconfig": before });
	assert.deepEqual(p.settle().changed, [".editorconfig"]);
	const after = p.text(".editorconfig");
	assert.ok(after.startsWith(before));
	assert.match(after, /\[\*\.\{md,markdown\}\]\nmax_line_length = off\n$/);
	assert.deepEqual(p.settle(), { changed: [], notes: [] }); // re-running the installer adds nothing
	assert.equal(p.text(".editorconfig"), after);
});

test("EditorConfig: a limit for other files only, or one already off for Markdown, changes nothing", () => {
	const p = project({ ".editorconfig": "[*.ts]\nmax_line_length = 100\n\n[*]\nmax_line_length = 120\n\n[*.md]\nmax_line_length = off\n" });
	assert.deepEqual(p.settle(), { changed: [], notes: [] });
});

test("remark-lint: the line-length rule or the preset that carries it is reported; one already off is not", () => {
	const on = project({ ".remarkrc.json": { plugins: ["remark-preset-lint-markdown-style-guide"] } });
	assert.match(on.settle().notes[0], /^\.remarkrc\.json: .*remark-lint-maximum-line-length/);
	const off = project({ ".remarkrc.json": { plugins: ["remark-preset-lint-markdown-style-guide", ["remark-lint-maximum-line-length", false]] } });
	assert.deepEqual(off.settle().notes, []);
});

test("dprint: textWrap always becomes maintain", () => {
	const p = project({ "dprint.json": { markdown: { textWrap: "always", lineWidth: 80 } } });
	p.settle();
	assert.deepEqual(p.json("dprint.json").markdown, { textWrap: "maintain", lineWidth: 80 });
});

test("the installer settles the linters, stages what it changed and always prints the reminder", () => {
	const p = project({ ".markdownlint.json": { MD013: true }, "prettier.config.mjs": 'export default { proseWrap: "always" };\n' });
	const git = (...args) => execFileSync("git", args, { cwd: p.root, encoding: "utf8" });
	git("init", "-q");
	const out = execFileSync(process.execPath, [join(here, "..", "install.mjs"), p.root], { encoding: "utf8" });
	assert.equal(p.json(".markdownlint.json").MD013, false);
	assert.ok(git("diff", "--cached", "--name-only").split("\n").includes(".markdownlint.json"));
	assert.match(out, /linters: .*\.markdownlint\.json/);
	assert.match(out, /note: .*prettier\.config\.mjs/);
	assert.ok(out.includes(REMINDER));
});
