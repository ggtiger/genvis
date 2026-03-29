const fs = require('fs');
const path = require('path');

const skillsDir = './skills';
const dataDir = process.env.SETTINGS_DIR || './data';
const registry = { version: 1, skills: [], updatedAt: new Date().toISOString() };

const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
for (const entry of entries) {
  if (!entry.isDirectory() || entry.name.startsWith('.')) continue;

  const endpointsPath = path.join(skillsDir, entry.name, 'api-endpoints.json');
  if (!fs.existsSync(endpointsPath)) continue;

  try {
    const config = JSON.parse(fs.readFileSync(endpointsPath, 'utf-8'));
    registry.skills.push({
      skillName: config.skillName,
      displayName: config.displayName,
      description: config.description,
      auth: config.auth || { authType: 'none' },
      endpoints: config.endpoints,
      registeredAt: new Date().toISOString()
    });
    console.log('Registered:', config.skillName);
  } catch (e) {
    console.warn('Failed to parse:', endpointsPath, e.message);
  }
}

fs.mkdirSync(dataDir, { recursive: true });
fs.writeFileSync(path.join(dataDir, 'api-skill-registry.json'), JSON.stringify(registry, null, 2));
console.log('Total skills:', registry.skills.length);
console.log('Registry saved to:', path.join(dataDir, 'api-skill-registry.json'));
