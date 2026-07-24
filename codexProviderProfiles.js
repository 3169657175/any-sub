const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROFILE_FILE = 'codex-provider-profiles.json';

function profilePath(userDataDir) {
  return path.join(userDataDir, PROFILE_FILE);
}

function readProfiles(userDataDir) {
  try {
    const parsed = JSON.parse(fs.readFileSync(profilePath(userDataDir), 'utf8'));
    return Array.isArray(parsed.profiles) ? parsed.profiles : [];
  } catch (_) {
    return [];
  }
}

function writeProfiles(userDataDir, profiles) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const target = profilePath(userDataDir);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify({ version: 1, profiles }, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, target);
}

function saveProfile(userDataDir, settings) {
  const profiles = readProfiles(userDataDir);
  const now = new Date().toISOString();
  const id = String(settings.id || '').trim() || crypto.randomUUID();
  const existing = profiles.find(item => item.id === id);
  const profile = {
    id,
    providerName: settings.providerName,
    protocol: settings.protocol,
    baseUrl: settings.baseUrl,
    apiKey: settings.apiKey,
    modelMode: settings.modelMode,
    models: settings.models,
    model: settings.model,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  const next = profiles.filter(item => item.id !== id);
  next.unshift(profile);
  writeProfiles(userDataDir, next);
  return profile;
}

function deleteProfile(userDataDir, id) {
  const profiles = readProfiles(userDataDir);
  const next = profiles.filter(item => item.id !== id);
  if (next.length === profiles.length) throw new Error('Provider 配置不存在');
  writeProfiles(userDataDir, next);
  return true;
}

module.exports = { PROFILE_FILE, profilePath, readProfiles, saveProfile, deleteProfile };
