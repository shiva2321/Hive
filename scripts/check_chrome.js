const { execSync } = require('child_process');

try {
  const out = execSync('powershell "Get-Process chrome | Select-Object -First 1 | % { (Get-CimInstance Win32_Process -Filter (\\\"ProcessId=\\\" + [string]\\"$_\\".Id)).CommandLine }"').toString();
  console.log('Result:', out);
} catch (e) {
  // Try wmic directly without quotes
  const out2 = execSync('wmic process get name,commandline').toString();
  const chromeLines = out2.split('\n').filter(l => l.includes('chrome.exe') && l.includes('http'));
  console.log('Chrome commandlines:', chromeLines.slice(0, 3));
}
