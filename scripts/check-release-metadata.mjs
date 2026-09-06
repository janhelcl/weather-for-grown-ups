import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));

const versions = {
  'package.json': pkg.version,
  'package-lock.json': lock.version,
  'package-lock.json root package': lock.packages?.['']?.version,
};

for (const [source, version] of Object.entries(versions)) {
  if (version !== pkg.version) {
    throw new Error(`${source} version ${JSON.stringify(version)} does not match package.json version ${JSON.stringify(pkg.version)}`);
  }
}

const [expectedTag] = process.argv.slice(2);
if (expectedTag !== undefined) {
  const actualTag = `v${pkg.version}`;
  if (expectedTag !== actualTag) {
    throw new Error(`release tag ${JSON.stringify(expectedTag)} does not match package version ${JSON.stringify(actualTag)}`);
  }
}

console.log(`Release metadata is consistent at ${pkg.version}.`);
