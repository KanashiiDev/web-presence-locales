#!/usr/bin/env node
/** Process all pending submissions against the live repository (CI only). */
import fs from "node:fs/promises";
import { createGitHubAdapter } from "../lib/adapters.js";
import { processSubmissions } from "../lib/processor.js";
import { githubJson } from "../lib/http.js";

const adapter = createGitHubAdapter({ token: process.env.GITHUB_TOKEN });

const summary = await processSubmissions({ adapter });
const text = `${JSON.stringify(summary, null, 2)}\n`;
console.log(text);

/** Escape untrusted text before placing it in a Markdown table cell. */
function cell(value) {
  return String(value ?? "-")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = [
    "## Submission processing",
    "",
    `- Pending: ${summary.pending}`,
    `- Processed: ${summary.processed}`,
    `- Skipped (already processed): ${summary.skipped}`,
    `- Source commit: ${summary.sourceCommit || "local mirror"}`,
    "",
    "| Submission | Language | Status | Reason |",
    "|---|---|---|---|",
    ...summary.results.map(
      (r) =>
        `| ${cell(r.id)} | ${cell(r.lang)} | ${cell(r.status)} | ${cell(r.reason || r.message)} |`,
    ),
    "",
  ];
  await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n"));
}

/**
 * Tell the contributor which keys were not applied. The submission is consumed
 * after processing, so a PR comment is the only feedback channel. Failures here
 * are logged but never break the processing job.
 */
async function notifyResults(results, token) {
  const repoPath = process.env.GITHUB_REPOSITORY
    ? `/repos/${process.env.GITHUB_REPOSITORY}`
    : "/repos/KanashiiDev/web-presence-locales";
  // Every processed submission gets a comment: with result files removed, this
  // is the only feedback channel the editor has, including for successes.
  for (const result of results) {
    if (result.status === "skipped" || result.status === "already-processed") continue;
    const marker = `<!-- submission-result:${result.id} -->`;
    const submissionPath = `submissions/${result.lang}/${result.id}.json`;
    try {
      const commits = await githubJson(
        `${repoPath}/commits?path=${encodeURIComponent(submissionPath)}&per_page=10`,
        { token },
      );
      const prNumber = commits
        .map((entry) => /(?:^|\s)#(\d+)\b/.exec(entry?.commit?.message || ""))
        .filter(Boolean)
        .map((match) => Number(match[1]))
        .find(Boolean);
      if (!prNumber) continue;
      const comments = await githubJson(
        `${repoPath}/issues/${prNumber}/comments?per_page=100`,
        { token },
      );
      if (
        comments.some((comment) => String(comment.body || "").includes(marker))
      )
        continue;
      const keys = [
        ...(result.qaDroppedKeys || []).map(
          (entry) => `${entry.key} (${entry.codes.join(", ")})`,
        ),
        ...(result.staleKeys || []).map((key) => `${key} (source changed)`),
        ...(result.conflictKeys || []).map((key) => `${key} (conflict)`),
      ];
      const hasIssues = keys.length > 0 || ["rejected", "error"].includes(result.status);
      const body = [
        marker,
        `## Translation submission \`${result.id}\``,
        "",
        `Status: **${result.status}**${result.reason ? ` — ${result.reason}` : ""}`,
        "",
        keys.length
          ? `Keys not applied:\n${keys.map((key) => `- \`${key}\``).join("\n")}`
          : "All submitted keys were applied.",
        "",
        hasIssues
          ? "Open the translation editor and resubmit the affected keys after reviewing them."
          : "Thanks for contributing!",
      ].join("\n");
      await githubJson(`${repoPath}/issues/${prNumber}/comments`, {
        token,
        method: "POST",
        body: { body },
      });
    } catch (err) {
      console.warn(`Could not notify PR for ${result.id}: ${err.message}`);
    }
  }
}

if (process.env.GITHUB_TOKEN && process.env.NOTIFY_RESULTS !== "false") {
  try {
    await notifyResults(summary.results, process.env.GITHUB_TOKEN);
  } catch (err) {
    console.warn(`Result notification failed: ${err.message}`);
  }
}

if (summary.results.some((r) => r.status === "error")) process.exitCode = 1;
