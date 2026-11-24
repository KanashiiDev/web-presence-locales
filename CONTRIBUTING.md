# Contributing translations

Thanks for helping translate [Web Presence](https://github.com/KanashiiDev/web-presence)!

**Contribute only through the translation editor in the Web Presence extension.** It creates the submission and opens the pull request for you. Do not edit this repository by hand or run local tooling against it.

## How it works

- Open a language in the editor and translate the strings it shows you.
- The editor creates one submission file with only the keys you changed, plus the hashes needed to detect source changes and conflicts. You do not need to write these yourself.
- Open the pull request the editor prepares.

CI checks every PR. When all checks pass and the PR only contains submission files, a bot review approves it automatically; otherwise a maintainer needs to review it. After the PR is merged, CI validates your submission against the live English source, applies safe changes, updates metadata, and posts the outcome as a comment on your pull request. If the source changed or someone edited the same key, those keys are skipped and listed in the comment - nothing is overwritten.

You can contribute in any language. The first submission for a new language creates its files and adds it to `locales/languages.json`; missing translations fall back to English.

## Rules

- Use the editor - do not edit files or add submissions manually.
- Keep placeholders such as `{count}` unchanged.
- `en` is owned by the main repository and cannot be translated here.

Questions? Open an issue in [this repository](https://github.com/KanashiiDev/web-presence-locales) or ask in the [Web Presence Discord](https://discord.gg/BWqcVKmb2P).
