# no-hard-line-breaks

A git pre-commit hook that joins hard-wrapped prose in Markdown files, so each paragraph or list item is one line. Renderers flow the text to the window's width, and editing a sentence changes one line in the diff instead of reflowing a whole paragraph.

It is deterministic (no AI) and conservative: only line breaks inside a paragraph are removed, and the rendered HTML stays the same. Headings, lists (each item is joined on its own), tables, fenced and indented code, front matter, HTML blocks, math blocks, link definitions, hard breaks (two trailing spaces, a backslash, `<br>`), labelled fields (two or more `Key: value` lines in a block, such as `Observed:` / `Evidence:`) and every line holding an HTML comment keep their lines.

## Files

| File | What it is |
| --- | --- |
| `no-hard-line-breaks.mjs` | The engine: the hook mode and a command-line formatter (Node, no dependencies) |
| `pre-commit` | The hook that calls it |
| `install.mjs` | Installs both into a project |
| `test/` | Tests: `node --test` |

## Set it up on your machine

Needs Node 18 or later, and nothing else. Clone the repository and put the two commands on your `PATH`, for example:

```bash
git clone https://github.com/claudio-silva/no-hard-line-breaks.git
ln -s "$PWD/no-hard-line-breaks/install.mjs" ~/bin/install-no-hard-line-breaks
ln -s "$PWD/no-hard-line-breaks/no-hard-line-breaks.mjs" ~/bin/no-hard-line-breaks
```

## Install it into a project

```bash
install-no-hard-line-breaks [project-path]    # default: the current directory
git commit -m "Shared pre-commit hook: no hard-wrapped Markdown prose"
```

The installer copies `pre-commit` and `no-hard-line-breaks.mjs` into the project's `.githooks/`, sets `core.hooksPath` to `.githooks` in that clone, adds an npm `prepare` script that sets it in every other clone on install (Node projects; others run `git config core.hooksPath .githooks` once), makes sure `.gitignore` does not ignore `.githooks/`, and stages the changes. Re-running it updates the copies. It refuses a repository whose `core.hooksPath` already belongs to another hook manager, and prints the line to add to that one's pre-commit instead.

Git never runs hooks that arrive with a clone by itself (a security rule), hence the `prepare` script. A pre-commit hook in `.git/hooks` keeps running (the shared hook calls it); other hooks there stop, and the installer lists them.

## What the hook does

On each commit it takes the staged Markdown files (`.md`, `.markdown`; not `.mdx`), joins the wrapped lines of the paragraphs the commit changes (untouched paragraphs are left alone), and updates the staged version. It also updates the working tree file when that file has no other unstaged changes; otherwise only the commit gets the joined lines, and a message says so. It never blocks a commit.

- Skip it once: `git commit --no-verify`.
- Opt a path out, in `.gitattributes`: `docs/legal/** -md-unwrap`.
- Always skipped: LICENSE, COPYING, NOTICE, AUTHORS, and anything under `node_modules`, `vendor` or `third_party`.

## Reformat whole files

```bash
no-hard-line-breaks --all            # every tracked Markdown file of the current repository
no-hard-line-breaks --check --all    # only list them; exit status 1 if any
no-hard-line-breaks README.md docs/*.md
```

In a project with the hook installed: `node .githooks/no-hard-line-breaks.mjs --all`.

## Enforcing it on the server

- **Self-managed GitLab** supports server-side `pre-receive` hooks (per project or instance-wide), which can only reject a push: running `no-hard-line-breaks --check` on the pushed files there would refuse wrapped prose, and the local hook fixes it.
- **GitHub.com and gitlab.com** run no custom server hooks: a CI job running `node .githooks/no-hard-line-breaks.mjs --check --all`, required for merging, is the equivalent.

## License

MIT, see [LICENSE](LICENSE).
