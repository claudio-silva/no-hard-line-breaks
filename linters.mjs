// Settles a project's linters and formatters with the hook, at install time. A project that installs this hook has chosen
// one line per paragraph, so a rule that limits line length in Markdown, or a formatter that wraps prose again, contradicts
// the hook. settleLinters() turns off the ones it knows where it can edit the configuration without guessing (JSON, a YAML
// key to append, a section to append), and returns a note naming the file and the setting where it cannot (JavaScript,
// comments, nested YAML). Tools it does not know are covered by REMINDER, which the installer always prints.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REMINDER =
	"Markdown lines are now as long as their paragraphs. If a linter or formatter this installer does not know (in the project, in an editor or in CI) limits line length in Markdown or wraps prose again, turn that rule off: it contradicts the hook.";

const parseJson = (text) => {
	try {
		const value = JSON.parse(text);
		return value && typeof value === "object" ? value : undefined;
	} catch {
		return undefined; // comments, JSON5, YAML: not ours to rewrite
	}
};
const jsonText = (value, like) => JSON.stringify(value, null, like.match(/^[ \t]+(?=")/m)?.[0] ?? "\t") + (like.endsWith("\n") ? "\n" : "");

/**
 * Makes the configuration of the linters and formatters found in `root` agree with the hook.
 * Returns the files it wrote (relative paths) and a note for each setting it found and could not change itself.
 */
export function settleLinters(root) {
	const changed = [];
	const notes = [];
	const read = (f) => (existsSync(join(root, f)) ? readFileSync(join(root, f), "utf8") : null);
	const write = (f, text) => {
		writeFileSync(join(root, f), text);
		if (!changed.includes(f)) changed.push(f);
	};
	const present = (names) => names.filter((n) => existsSync(join(root, n)));
	const pkg = () => parseJson(read("package.json") ?? "") ?? {};
	const deps = { ...pkg().dependencies, ...pkg().devDependencies };

	// --- Prettier: stop it wrapping prose.
	const prettierFiles = present([
		".prettierrc",
		".prettierrc.json",
		".prettierrc.json5",
		".prettierrc.yaml",
		".prettierrc.yml",
		".prettierrc.toml",
		".prettierrc.js",
		".prettierrc.cjs",
		".prettierrc.mjs",
		".prettierrc.ts",
		"prettier.config.js",
		"prettier.config.cjs",
		"prettier.config.mjs",
		"prettier.config.ts",
	]);
	const unwrapProse = (o) => {
		let n = 0;
		if (!o || typeof o !== "object") return n;
		if (o.proseWrap === "always") {
			o.proseWrap = "preserve";
			n++;
		}
		for (const v of Object.values(o)) n += unwrapProse(v); // overrides[].options
		return n;
	};
	const PROSE = 'set proseWrap to "preserve": "always" makes Prettier wrap Markdown prose again';
	for (const f of prettierFiles) {
		const text = read(f);
		const cfg = parseJson(text);
		if (cfg) {
			if (unwrapProse(cfg)) write(f, jsonText(cfg, text));
		} else if (/proseWrap["']?\s*[:=]\s*["']?always/.test(text)) notes.push(`${f}: ${PROSE}`);
	}
	if (pkg().prettier && typeof pkg().prettier === "object") {
		const text = read("package.json");
		const all = parseJson(text);
		if (unwrapProse(all.prettier)) write("package.json", jsonText(all, text));
	}

	// --- markdownlint: MD013 (line-length) is on by default, at 80 columns.
	const MD013 = 'set "MD013": false (the line-length rule)';
	const mdOff = (cfg) => {
		if (cfg.MD013 === false || cfg["line-length"] === false) return false;
		delete cfg["line-length"];
		cfg.MD013 = false;
		return true;
	};
	const mdFiles = present([".markdownlint.jsonc", ".markdownlint.json", ".markdownlintrc", ".markdownlint.yaml", ".markdownlint.yml", ".markdownlint.cjs", ".markdownlint.mjs"]);
	const mdCli2 = present([".markdownlint-cli2.jsonc", ".markdownlint-cli2.yaml", ".markdownlint-cli2.cjs", ".markdownlint-cli2.mjs"]);
	for (const f of mdFiles) {
		const text = read(f);
		if (/\.ya?ml$/.test(f)) {
			const m = text.match(/^(MD013|line-length)[ \t]*:[ \t]*([^#\n]*)/m);
			if (!m) write(f, `${text}${text && !text.endsWith("\n") ? "\n" : ""}# no-hard-line-breaks: Markdown prose is not wrapped\nMD013: false\n`);
			else if (m[2].trim() !== "false") notes.push(`${f}: ${MD013}`);
			continue;
		}
		const cfg = parseJson(text);
		if (cfg) {
			if (mdOff(cfg)) write(f, jsonText(cfg, text));
		} else notes.push(`${f}: ${MD013}`);
	}
	for (const f of mdCli2) {
		const text = read(f);
		const cfg = parseJson(text);
		if (cfg) {
			cfg.config ??= {};
			if (mdOff(cfg.config)) write(f, jsonText(cfg, text));
		} else notes.push(`${f}: under "config", ${MD013}`);
	}
	if (pkg()["markdownlint-cli2"]) notes.push(`package.json: under "markdownlint-cli2" > "config", ${MD013}`);
	else if (!mdFiles.length && !mdCli2.length && (deps.markdownlint || deps["markdownlint-cli"] || deps["markdownlint-cli2"]))
		write(".markdownlint.json", '{\n\t"MD013": false\n}\n');

	// --- remark-lint: the rule itself, or the style-guide preset that includes it.
	const remark = [...present([".remarkrc", ".remarkrc.json", ".remarkrc.js", ".remarkrc.cjs", ".remarkrc.mjs", ".remarkrc.yml", ".remarkrc.yaml"]).map((f) => [f, read(f)])];
	if (pkg().remarkConfig) remark.push(["package.json (remarkConfig)", JSON.stringify(pkg().remarkConfig)]);
	for (const [f, text] of remark)
		if (/maximum-line-length|preset-lint-markdown-style-guide/.test(text) && !/maximum-line-length["']?\s*,\s*false/.test(text))
			notes.push(`${f}: turn off remark-lint-maximum-line-length, with ["remark-lint-maximum-line-length", false] after the presets`);

	// --- EditorConfig: a max_line_length that reaches Markdown makes editors and some formatters wrap it. A later section wins.
	const editorconfig = read(".editorconfig");
	if (editorconfig !== null) {
		let applies = false;
		let limit = "off";
		for (const line of editorconfig.split("\n")) {
			const section = line.match(/^\s*\[(.*)\]\s*$/);
			if (section) applies = section[1] === "*" || /^\*\*(\/\*)?$/.test(section[1]) || /\bmd\b|markdown/.test(section[1]);
			const set = applies && line.match(/^\s*max_line_length\s*=\s*([^#;\s]+)/i);
			if (set) limit = set[1].toLowerCase();
		}
		if (limit !== "off" && limit !== "unset")
			write(".editorconfig", `${editorconfig}${editorconfig.endsWith("\n") ? "" : "\n"}\n# no-hard-line-breaks: Markdown prose is not wrapped\n[*.{md,markdown}]\nmax_line_length = off\n`);
	}

	// --- dprint: its Markdown plugin wraps prose when told to.
	for (const f of present(["dprint.json", ".dprint.json", "dprint.jsonc", ".dprint.jsonc"])) {
		const text = read(f);
		const cfg = parseJson(text);
		if (cfg?.markdown?.textWrap === "always") {
			cfg.markdown.textWrap = "maintain";
			write(f, jsonText(cfg, text));
		} else if (!cfg && /"textWrap"\s*:\s*"always"/.test(text)) notes.push(`${f}: under "markdown", set "textWrap" to "maintain"`);
	}

	return { changed, notes };
}
