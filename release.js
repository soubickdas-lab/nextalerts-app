// One command to ship a new version of every app:   node release.js 1.0.3
// It writes the version into the desktop and iPhone projects, commits, tags v1.0.3 and pushes.
// GitHub then builds the exe, dmg and apk and attaches them to a release; installed apps offer the update.
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const v = (process.argv[2] || "").replace(/^v/, "");
if (!/^\d+\.\d+\.\d+$/.test(v)) {
  console.error("Usage: node release.js 1.2.3");
  process.exit(1);
}
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit", cwd: __dirname });

for (const f of ["desktop/package.json", "desktop/package-lock.json"]) {
  const p = `${__dirname}/${f}`;
  const j = JSON.parse(fs.readFileSync(p, "utf8"));
  j.version = v;
  if (j.packages && j.packages[""]) j.packages[""].version = v;
  fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
}
const yml = `${__dirname}/ios/project.yml`;
fs.writeFileSync(yml, fs.readFileSync(yml, "utf8").replace(/MARKETING_VERSION: .*/, `MARKETING_VERSION: "${v}"`));

// the SideStore / AltStore source: one address that always points at the newest iPhone build
const srcFile = `${__dirname}/sidestore.json`;
const src = JSON.parse(fs.readFileSync(srcFile, "utf8"));
const ipa = `https://github.com/soubickdas-lab/nextalerts-app/releases/download/v${v}/NextAlerts-${v}.ipa`;
const when = new Date().toISOString().replace(/\.\d+Z$/, "Z");
const a0 = src.apps[0];
a0.versions = [{ ...a0.versions[0], version: v, date: when, downloadURL: ipa }, ...a0.versions.filter((x) => x.version !== v)].slice(0, 5);
Object.assign(a0, { version: v, versionDate: when, downloadURL: ipa });
fs.writeFileSync(srcFile, JSON.stringify(src, null, 2) + "\n");

run("git", ["add", "-A"]);
run("git", ["commit", "-m", `Release v${v}`, "--allow-empty"]);
run("git", ["tag", `v${v}`]);
run("git", ["push", "origin", "HEAD", `v${v}`]);
console.log(`\nv${v} pushed. Builds: https://github.com/soubickdas-lab/nextalerts-app/actions`);
