import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
const server = JSON.parse(fs.readFileSync('server.json', 'utf8'));

const versions = {
  'package.json': pkg.version,
  'package-lock.json': lock.version,
  'package-lock.json root package': lock.packages?.['']?.version,
  'server.json': server.version,
};

for (const [source, version] of Object.entries(versions)) {
  if (version !== pkg.version) {
    throw new Error(`${source} version ${JSON.stringify(version)} does not match package.json version ${JSON.stringify(pkg.version)}`);
  }
}

const expectedMcpName = 'io.github.janhelcl/weather-for-grown-ups';
if (pkg.mcpName !== expectedMcpName) {
  throw new Error(`package.json mcpName ${JSON.stringify(pkg.mcpName)} does not match ${JSON.stringify(expectedMcpName)}`);
}
if (server.name !== expectedMcpName) {
  throw new Error(`server.json name ${JSON.stringify(server.name)} does not match package.json mcpName ${JSON.stringify(pkg.mcpName)}`);
}

const npmPackage = server.packages?.find(
  (candidate) =>
    candidate?.registryType === 'npm' &&
    candidate?.identifier === pkg.name &&
    candidate?.version === pkg.version,
);
if (!npmPackage) {
  throw new Error(`server.json must publish npm package ${pkg.name}@${pkg.version}`);
}
if (npmPackage.transport?.type !== 'stdio') {
  throw new Error('server.json npm package transport must be stdio');
}
const launchesMcp = npmPackage.packageArguments?.some(
  (argument) => argument?.type === 'positional' && argument?.value === 'mcp',
);
if (!launchesMcp) {
  throw new Error('server.json npm package must launch the package-name binary with positional argument "mcp"');
}

for (const requiredFile of ['server.json', 'skills']) {
  if (!pkg.files?.includes(requiredFile)) {
    throw new Error(`package.json files must include ${JSON.stringify(requiredFile)}`);
  }
}

const skillPath = 'skills/weather-for-grown-ups/SKILL.md';
const skill = fs.readFileSync(skillPath, 'utf8');
const frontmatterMatch = skill.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
if (!frontmatterMatch) {
  throw new Error(`${skillPath} must begin with YAML frontmatter`);
}

const frontmatter = frontmatterMatch[1];
const topLevelKeys = frontmatter
  .split(/\r?\n/)
  .filter((line) => /^[A-Za-z][A-Za-z0-9-]*:/.test(line))
  .map((line) => line.slice(0, line.indexOf(':')));

const allowedSkillKeys = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
]);
for (const key of topLevelKeys) {
  if (!allowedSkillKeys.has(key)) {
    throw new Error(`${skillPath} has unsupported top-level frontmatter key ${JSON.stringify(key)}`);
  }
}

const readScalar = (key) => {
  const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2');
};

const skillName = readScalar('name');
if (skillName !== 'weather-for-grown-ups') {
  throw new Error(`${skillPath} name must match its parent directory`);
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(skillName) || skillName.length > 64) {
  throw new Error(`${skillPath} name does not satisfy the Agent Skills naming rules`);
}

const description = readScalar('description');
if (!description || description.length > 1024) {
  throw new Error(`${skillPath} description must contain 1-1024 characters`);
}

const compatibility = readScalar('compatibility');
if (compatibility && compatibility.length > 500) {
  throw new Error(`${skillPath} compatibility must not exceed 500 characters`);
}

const [expectedTag] = process.argv.slice(2);
if (expectedTag !== undefined) {
  const actualTag = `v${pkg.version}`;
  if (expectedTag !== actualTag) {
    throw new Error(`release tag ${JSON.stringify(expectedTag)} does not match package version ${JSON.stringify(actualTag)}`);
  }
}

console.log(`Release metadata is consistent at ${pkg.version}; MCP Registry metadata and Agent Skill are aligned.`);
