// Pre-publish coherence guards. Run by .github/workflows/publish.yml before staging.
//
// Every check here is a failure this package has ALREADY had. None is hypothetical:
//
//   1. TAG vs package.json — v2.16.1 is tagged, 2.16.2 and 2.16.3 never were, so the
//      tags and the published versions have already diverged once. A tag that does not
//      match the manifest ships a version nobody can find by tag afterwards.
//   2. ALREADY PUBLISHED — the registry rejects a duplicate version, but late and with
//      an auth-shaped error. Saying so up front is the difference between "you forgot
//      to bump" and half an hour re-reading token scopes.
//   3. README HEADER vs package.json — `## Tools (vX.Y.Z — N total)` is hand-maintained
//      and bumped on every release since 2.14.0. cc9d593 bumped package.json to 2.16.3
//      and missed it, so 2.16.3 would have shipped a README calling itself 2.16.2. It
//      ships INSIDE the tarball, and no code path can catch prose.
//
// ⚠ Guard 3 is the one worth keeping honest. It is easy to read as pedantry until you
// remember the version was the SECOND thing wrong in that release — the first was three
// contradictory catalogue figures in the same file, which shipped and sat wrong for
// months because nothing compared them either.

import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
const version = pkg.version;
const fails = [];

console.log(`package.json version: ${version}`);

// ── 1. tag ↔ manifest ────────────────────────────────────────────────────────
const tag = (process.env.RELEASE_TAG || '').trim();
if (tag) {
  const tagVersion = tag.replace(/^v/, '');
  if (tagVersion !== version) {
    fails.push(`tag ${tag} does not match package.json ${version} — bump one to match the other`);
  } else {
    console.log(`  ok  tag ${tag} matches`);
  }
} else {
  console.log('  --  no tag (manual run); skipping the tag check');
}

// ── 2. not already on the registry ───────────────────────────────────────────
try {
  const res = await fetch(`https://registry.npmjs.org/${pkg.name}`, {
    headers: { accept: 'application/json' },
  });
  if (res.ok) {
    const doc = await res.json();
    if (Object.hasOwn(doc.versions ?? {}, version)) {
      fails.push(`${pkg.name}@${version} is already published — bump the version`);
    } else {
      console.log(`  ok  ${version} is not on the registry yet (latest: ${doc['dist-tags']?.latest})`);
    }
  } else {
    // Fail OPEN: a registry blip must not block a release. The publish itself is the
    // real gate — it rejects a duplicate version regardless of what this check saw.
    console.log(`  --  registry check skipped (HTTP ${res.status})`);
  }
} catch (err) {
  console.log(`  --  registry check skipped (${err.message})`);
}

// ── 3. README header ↔ manifest ──────────────────────────────────────────────
const header = /^##\s+Tools\s+\(v(\d+\.\d+\.\d+)\s/m.exec(readme);
if (!header) {
  // Not a hard failure: the header could legitimately be reworded. But say so — a
  // check that silently stops checking is worse than no check, which is exactly how
  // the frozen-headline bug survived three months on the website.
  console.log('  !!  README has no `## Tools (vX.Y.Z ...)` header — guard 3 is now inert, fix or remove it');
} else if (header[1] !== version) {
  fails.push(`README header says v${header[1]} but package.json says ${version} — it ships inside the tarball`);
} else {
  console.log(`  ok  README header says v${header[1]}`);
}

// ─────────────────────────────────────────────────────────────────────────────
if (fails.length) {
  console.error('\nRelease blocked:');
  for (const f of fails) console.error(`  ✗ ${f}`);
  process.exit(1);
}
console.log('\nAll release checks passed.');
