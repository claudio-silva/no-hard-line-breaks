#!/usr/bin/env node
// Installs the no-hard-line-breaks pre-commit hook into a git repository, as files committed with it, so every developer
// gets the same rule.
//
//   install-no-hard-line-breaks [project-path]      (default: the current directory)
//
// It copies pre-commit and no-hard-line-breaks.mjs into <project>/.githooks/, points this clone's core.hooksPath at
// .githooks, adds an npm "prepare" script that does the same in every other clone (Node projects), makes sure .gitignore
// does not ignore the hook, and stages the changes. Committing them is up to you. Re-running it updates the hook.

import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(realpathSync(fileURLToPath(import.meta.url)));
const HOOKS_DIR = ".githooks";
const MARKER = "no-hard-line-breaks";
const ACTIVATE = `node -e "try{require('child_process').execSync('git config core.hooksPath ${HOOKS_DIR}',{stdio:'ignore'})}catch(e){}"`;

const arg = process.argv[2];
if (arg === "-h" || arg === "--help") {
	console.log("usage: install-no-hard-line-breaks [project-path]   (default: the current directory)");
	process.exit(0);
}

const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fail = (msg) => {
	console.error(`install-no-hard-line-breaks: ${msg}`);
	process.exit(1);
};
const notes = [];

let root;
try {
	root = git(["rev-parse", "--show-toplevel"], resolve(arg ?? "."));
} catch {
	fail(`${resolve(arg ?? ".")} is not inside a git repository`);
}

// 1. Another hook manager already owns core.hooksPath: do not take it over.
let hooksPath = "";
try {
	hooksPath = git(["config", "--get", "core.hooksPath"], root);
} catch {
	/* unset */
}
if (hooksPath && hooksPath.replace(/\/$/, "") !== HOOKS_DIR) {
	fail(
		`core.hooksPath is already "${hooksPath}" (another hook manager?). Add this line to its pre-commit hook instead:\n` +
			`  node "$(git rev-parse --show-toplevel)/${HOOKS_DIR}/no-hard-line-breaks.mjs" --hook\n` +
			`and copy ${join(here, "no-hard-line-breaks.mjs")} to ${join(root, HOOKS_DIR)}/.`,
	);
}

// 2. Copy the files.
const dir = join(root, HOOKS_DIR);
mkdirSync(dir, { recursive: true });
copyFileSync(join(here, "no-hard-line-breaks.mjs"), join(dir, "no-hard-line-breaks.mjs"));
const hookFile = join(dir, "pre-commit");
const ours = readFileSync(join(here, "pre-commit"), "utf8");
if (existsSync(hookFile) && !readFileSync(hookFile, "utf8").includes(MARKER)) {
	// The project has its own pre-commit in .githooks: call ours from it rather than replace it.
	const existing = readFileSync(hookFile, "utf8");
	const call = `\n# ${MARKER}: joins hard-wrapped prose in the Markdown being committed.\ncommand -v node >/dev/null 2>&1 && node "$(dirname "$0")/no-hard-line-breaks.mjs" --hook\n`;
	writeFileSync(hookFile, existing.replace(/\n?$/, "\n") + call);
	notes.push(`${HOOKS_DIR}/pre-commit already existed: a call to the formatter was appended to it`);
} else writeFileSync(hookFile, ours);
chmodSync(hookFile, 0o755);

// 3. Activate it in this clone, and warn about hooks in .git/hooks that core.hooksPath turns off.
git(["config", "core.hooksPath", HOOKS_DIR], root);
const legacyDir = join(git(["rev-parse", "--git-common-dir"], root).replace(/^(?!\/)/, `${root}/`), "hooks");
if (existsSync(legacyDir)) {
	const off = readdirSync(legacyDir).filter((f) => !f.endsWith(".sample") && f !== "pre-commit");
	if (off.length) notes.push(`these hooks in .git/hooks no longer run (core.hooksPath replaces that folder); move them to ${HOOKS_DIR}/: ${off.join(", ")}`);
}

// 4. Activate it in every other clone: npm's "prepare" runs on install (npm, pnpm, bun).
const pkgFile = join(root, "package.json");
let npm = false;
if (existsSync(pkgFile)) {
	const text = readFileSync(pkgFile, "utf8");
	const pkg = JSON.parse(text);
	const prepare = pkg.scripts?.prepare;
	if (!prepare?.includes("core.hooksPath")) {
		pkg.scripts = { ...pkg.scripts, prepare: prepare ? `${ACTIVATE} && ${prepare}` : ACTIVATE };
		const indent = text.match(/^[ \t]+(?=")/m)?.[0] ?? "\t";
		writeFileSync(pkgFile, JSON.stringify(pkg, null, indent) + (text.endsWith("\n") ? "\n" : ""));
	}
	npm = true;
}

// 5. .gitignore must not hide the hook from the repository.
const files = [`${HOOKS_DIR}/pre-commit`, `${HOOKS_DIR}/no-hard-line-breaks.mjs`];
const ignored = () => {
	try {
		return git(["check-ignore", "--no-index", ...files], root).split("\n").filter(Boolean);
	} catch {
		return []; // exit status 1: nothing ignored
	}
};
if (ignored().length) {
	const gi = join(root, ".gitignore");
	const text = existsSync(gi) ? readFileSync(gi, "utf8") : "";
	writeFileSync(gi, `${text}${text && !text.endsWith("\n") ? "\n" : ""}\n# The shared git hooks are part of the repository\n!/${HOOKS_DIR}/\n!/${HOOKS_DIR}/**\n`);
	if (ignored().length) notes.push(`.gitignore still ignores ${ignored().join(", ")} (a parent folder is excluded?); they were added with git add -f, which keeps them tracked`);
	else notes.push(`.gitignore ignored ${HOOKS_DIR}/: a negation rule was added`);
}

// 6. Stage everything, forcing past any ignore rule that remains.
git(["add", "-f", "--", ...files], root);
const stageable = (f) => {
	if (!existsSync(join(root, f))) return false;
	try {
		git(["ls-files", "--error-unmatch", "--", f], root);
		return true; // tracked
	} catch {
		try {
			git(["check-ignore", "-q", "--", f], root);
			return false; // untracked and ignored: leave it alone
		} catch {
			return true;
		}
	}
};
const extra = ["package.json", ".gitignore"].filter(stageable);
if (extra.length) git(["add", "--", ...extra], root);

console.log(`no-hard-line-breaks installed in ${root}`);
console.log(`  staged: ${[...files, ...extra].join(", ")}; commit them so every clone gets the hook`);
console.log(
	npm
		? "  other clones: activated by the npm prepare script on the next install"
		: `  other clones: each developer runs once  git config core.hooksPath ${HOOKS_DIR}`,
);
console.log(`  reformat every Markdown file now:  node ${HOOKS_DIR}/no-hard-line-breaks.mjs --all   (--check to only list them)`);
console.log("  opt a path out (.gitattributes):  docs/legal/** -md-unwrap");
for (const n of notes) console.log(`  note: ${n}`);
