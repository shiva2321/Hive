const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

console.log('====================================================');
console.log('🐝 Hive Extension Packaging & Web Store Bundle Builder');
console.log('====================================================');

const extensionDir = path.join(__dirname, '../extension');
const distDir = path.join(__dirname, '../dist');
const uiDir = path.join(__dirname, '../ui');

if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir, { recursive: true });
}

// 1. Validate manifest
const manifestPath = path.join(extensionDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error('[-] Error: manifest.json not found in', extensionDir);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
console.log(`[+] Manifest V${manifest.manifest_version} valid: ${manifest.name} (v${manifest.version})`);

// 2. Validate essential files
const requiredFiles = [
  'manifest.json',
  'background.js',
  'content_script.js',
  'popup.html',
  'popup.js',
  'icons/icon16.png',
  'icons/icon48.png',
  'icons/icon128.png'
];

let allValid = true;
requiredFiles.forEach(f => {
  const p = path.join(extensionDir, f);
  if (!fs.existsSync(p)) {
    console.error(`[-] Missing required file: ${f}`);
    allValid = false;
  } else {
    const size = fs.statSync(p).size;
    console.log(`  ✓ ${f} (${size} bytes)`);
  }
});

if (!allValid) {
  process.exit(1);
}

// 3. Build Zip Bundle
const zip = new AdmZip();
zip.addLocalFolder(extensionDir);

const zipName = `hive-ai-memory-extension-v${manifest.version}.zip`;
const distZipPath = path.join(distDir, zipName);
const genericDistZip = path.join(distDir, 'hive-ai-memory-extension.zip');
const uiZipPath = path.join(uiDir, 'hive-ai-memory-extension.zip');

zip.writeZip(distZipPath);
zip.writeZip(genericDistZip);
zip.writeZip(uiZipPath);

const os = require('os');
const userDownloads = path.join(os.homedir(), 'Downloads', 'hive-ai-memory-extension');
try {
  if (!fs.existsSync(userDownloads)) {
    fs.mkdirSync(userDownloads, { recursive: true });
  }
  fs.cpSync(extensionDir, userDownloads, { recursive: true });
  console.log(`- Unpacked Dev Folder: ${userDownloads} (synced)`);
} catch (e) {
  console.warn('[-] Could not auto-sync to Downloads folder:', e.message);
}

console.log('====================================================\n');
