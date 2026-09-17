// count-contributions.js
// Finds every repo where GITHUB_USERNAME has a merged PR, counts how many
// commits by that user exist on each repo's default branch, and writes a
// sorted "repo — N commits" list into README.md between marker comments.
//
// Env vars required:
//   GITHUB_TOKEN     - a token with public_repo (or repo) scope
//   GITHUB_USERNAME  - your GitHub username
// Optional:
//   README_PATH      - defaults to "README.md"

import fs from "fs";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const USERNAME = process.env.GITHUB_USERNAME;
const README_PATH = process.env.README_PATH || "README.md";
const START_MARKER = "<!-- start: contributions-list -->";
const END_MARKER = "<!-- end: contributions-list -->";

if (!GITHUB_TOKEN || !USERNAME) {
  console.error("GITHUB_TOKEN and GITHUB_USERNAME must be set.");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

// Step 1: find every repo where the user has at least one merged PR.
async function getMergedPrRepos() {
  const repos = new Set();
  let page = 1;

  while (true) {
    const url =
      `https://api.github.com/search/issues?q=author:${USERNAME}+type:pr+is:merged+is:public+-user:${USERNAME}` +
      `&per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`Search API failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    if (!data.items || data.items.length === 0) break;

    for (const item of data.items) {
      // repository_url looks like: https://api.github.com/repos/owner/repo
      const repoFullName = item.repository_url.split("/repos/")[1];
      repos.add(repoFullName);
    }

    if (data.items.length < 100) break;
    page++;
  }

  return [...repos];
}

// Step 2: count commits by the user on a repo's default branch.
// Uses the trick of reading the "last page" number from the Link header
// with per_page=1, instead of fetching every commit.
async function countCommits(repoFullName) {
  const url = `https://api.github.com/repos/${repoFullName}/commits?author=${USERNAME}&per_page=1`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    // e.g. empty repo, or default branch changed mid-flight — skip it
    return 0;
  }

  const link = res.headers.get("link");
  if (link) {
    const match = link.match(/[&?]page=(\d+)>;\s*rel="last"/);
    if (match) return parseInt(match[1], 10);
  }

  // No Link header means there's only one page (0 or 1 commit).
  const data = await res.json();
  return Array.isArray(data) ? data.length : 0;
}

async function main() {
  console.log(`Finding repos with merged PRs by ${USERNAME}...`);
  const repos = await getMergedPrRepos();
  console.log(`Found ${repos.length} repos. Counting commits...`);

  const results = [];
  for (const repo of repos) {
    const count = await countCommits(repo);
    if (count > 0) {
      results.push({ repo, count });
      console.log(`  ${repo}: ${count}`);
    }
  }

  results.sort((a, b) => b.count - a.count);

  const lines = results
    .map(
      ({ repo, count }) =>
        `- [${repo}](https://github.com/${repo}) — ${count} commit${count === 1 ? "" : "s"}`
    )
    .join("\n");

  const readme = fs.readFileSync(README_PATH, "utf8");
  const pattern = new RegExp(`${START_MARKER}[\\s\\S]*?${END_MARKER}`);

  if (!pattern.test(readme)) {
    console.error(
      `Could not find "${START_MARKER}" / "${END_MARKER}" markers in ${README_PATH}. Add them first.`
    );
    process.exit(1);
  }

  const updated = readme.replace(pattern, `${START_MARKER}\n${lines}\n${END_MARKER}`);
  fs.writeFileSync(README_PATH, updated);
  console.log("README updated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
