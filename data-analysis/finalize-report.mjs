import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const analysisDirectory = dirname(fileURLToPath(import.meta.url));
const pluginRootArgument = process.argv[2];

if (!pluginRootArgument) {
  throw new Error("Usage: node data-analysis/finalize-report.mjs <data-analytics-plugin-root>");
}

const pluginRoot = resolve(pluginRootArgument);
const artifactPath = resolve(analysisDirectory, "artifact.json");
const reportPath = resolve(analysisDirectory, "report.html");
const failureScreenshotPath = resolve(analysisDirectory, "report-verification-failure.png");
const builderPath = resolve(pluginRoot, "skills/build-report/scripts/build_portable_artifact.mjs");
const verifierPath = resolve(pluginRoot, "skills/build-report/scripts/verify_portable_artifact.mjs");

execFileSync(process.execPath, [builderPath, "--input", artifactPath, "--output", reportPath], {
  stdio: "inherit",
});

const widthFix = '<style data-portable-width-fix>.analytics-top-bar{width:100%!important;margin-right:0!important;margin-left:0!important}</style>';
const reportHtml = readFileSync(reportPath, "utf8");

if (!reportHtml.includes("</head>")) {
  throw new Error("Portable report is missing its closing head tag.");
}

writeFileSync(reportPath, reportHtml.replace("</head>", `${widthFix}</head>`), "utf8");

execFileSync(process.execPath, [
  verifierPath,
  "--html",
  reportPath,
  "--artifact",
  artifactPath,
  "--screenshot",
  failureScreenshotPath,
], {
  stdio: "inherit",
});
