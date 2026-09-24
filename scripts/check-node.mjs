// Fails fast with a readable message when Node.js is too old (native deps and tooling need >= 20.19).
const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
const supported = major > 20 || (major === 20 && minor >= 19);

if (!supported) {
  console.error(
    `\nNode.js ${process.versions.node} is not supported.\n` +
      'Please use Node.js 22 or 24 LTS (minimum 20.19). See README.md → "Gereksinimler".\n',
  );
  process.exit(1);
}
