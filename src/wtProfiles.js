'use strict'

const fs = require('node:fs')
const path = require('node:path')

const DEFAULT_FALLBACK = ['Windows PowerShell', 'Command Prompt', 'PowerShell', 'Ubuntu']

function candidateSettingsPaths() {
  const localAppData = process.env.LOCALAPPDATA || ''
  if (!localAppData) return []
  return [
    path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminal_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(localAppData, 'Packages', 'Microsoft.WindowsTerminalPreview_8wekyb3d8bbwe', 'LocalState', 'settings.json'),
    path.join(localAppData, 'Microsoft', 'Windows Terminal', 'settings.json'),
  ]
}

function stripJsonc(text) {
  let out = ''
  let i = 0
  const n = text.length
  let inStr = false
  let strCh = ''
  while (i < n) {
    const c = text[i]
    const next = text[i + 1]
    if (inStr) {
      out += c
      if (c === '\\' && i + 1 < n) { out += text[i + 1]; i += 2; continue }
      if (c === strCh) inStr = false
      i++
      continue
    }
    if (c === '"' || c === "'") { inStr = true; strCh = c; out += c; i++; continue }
    if (c === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && next === '*') {
      i += 2
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) i++
      i += 2
      continue
    }
    out += c
    i++
  }
  return out
}

function stripTrailingCommas(text) {
  return text.replace(/,(\s*[}\]])/g, '$1')
}

function parseJsonc(text) {
  try { return JSON.parse(text) } catch (_) {}
  const cleaned = stripTrailingCommas(stripJsonc(text))
  return JSON.parse(cleaned)
}

function extractProfileNames(settings) {
  if (!settings || typeof settings !== 'object') return []
  const list = settings.profiles && Array.isArray(settings.profiles.list)
    ? settings.profiles.list
    : Array.isArray(settings.profiles) ? settings.profiles : []
  const names = []
  for (const p of list) {
    if (!p || typeof p !== 'object') continue
    if (p.hidden === true) continue
    if (typeof p.name === 'string' && p.name.trim()) names.push(p.name.trim())
  }
  const seen = new Set()
  return names.filter(n => (seen.has(n) ? false : (seen.add(n), true)))
}

function profileList(settings) {
  if (!settings || typeof settings !== 'object') return []
  const list = settings.profiles && Array.isArray(settings.profiles.list)
    ? settings.profiles.list
    : Array.isArray(settings.profiles) ? settings.profiles : []
  return list.filter(p => p && typeof p === 'object' && p.hidden !== true)
}

function normalizeProfileId(value) {
  if (typeof value !== 'string') return ''
  return value.trim().replace(/^\{|\}$/g, '').toLowerCase()
}

function findDefaultProfile(settings) {
  if (!settings || typeof settings !== 'object') return null
  const target = typeof settings.defaultProfile === 'string' ? settings.defaultProfile.trim() : ''
  if (!target) return null
  const targetId = normalizeProfileId(target)
  const targetName = target.toLowerCase()
  for (const profile of profileList(settings)) {
    const guid = normalizeProfileId(profile.guid)
    if (guid && guid === targetId) return profile
    const name = typeof profile.name === 'string' ? profile.name.trim().toLowerCase() : ''
    if (name && name === targetName) return profile
  }
  return null
}

function profileShellKind(profileOrName) {
  const profile = typeof profileOrName === 'string' ? { name: profileOrName } : profileOrName
  if (!profile || typeof profile !== 'object') return null
  const name = typeof profile.name === 'string' ? profile.name.toLowerCase() : ''
  const commandline = typeof profile.commandline === 'string' ? profile.commandline.toLowerCase() : ''
  const source = typeof profile.source === 'string' ? profile.source.toLowerCase() : ''
  const text = `${name} ${commandline} ${source}`
  if (/\bcmd(?:\.exe)?\b/.test(commandline) || name === 'cmd' || name.includes('command prompt')) return 'cmd'
  if (text.includes('bash') || text.includes('wsl') || text.includes('ubuntu')) return 'bash'
  if (text.includes('powershell') || text.includes('pwsh')) return 'pwsh'
  return null
}

function defaultProfileShellKind(settings) {
  const profile = findDefaultProfile(settings)
  if (profile) return profileShellKind(profile)
  if (settings && typeof settings.defaultProfile === 'string') {
    return profileShellKind(settings.defaultProfile)
  }
  return null
}

function readProfilesFromFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8')
  return extractProfileNames(parseJsonc(raw))
}

function _withCandidates(candidates) {
  let lastError = null
  let sawAnyFile = false
  for (const candidate of candidates) {
    try {
      if (!fs.existsSync(candidate)) continue
      sawAnyFile = true
      const names = readProfilesFromFile(candidate)
      if (names.length) return { source: candidate, profiles: names, fallback: false }
      lastError = `${candidate}: parsed but contained no profiles`
    } catch (err) {
      lastError = `${candidate}: ${err && err.message ? err.message : String(err)}`
    }
  }
  const error = lastError || (sawAnyFile
    ? 'Windows Terminal settings.json found but unreadable'
    : 'no settings.json found in any known location')
  return { source: null, profiles: DEFAULT_FALLBACK.slice(), fallback: true, error }
}

function discoverProfiles() {
  return _withCandidates(candidateSettingsPaths())
}

module.exports = {
  discoverProfiles,
  _withCandidates,
  readProfilesFromFile,
  extractProfileNames,
  parseJsonc,
  stripJsonc,
  stripTrailingCommas,
  findDefaultProfile,
  profileShellKind,
  defaultProfileShellKind,
  candidateSettingsPaths,
  DEFAULT_FALLBACK,
}
