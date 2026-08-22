'use strict';
// Reads configuration synchronously (as VS Code does) and asks the user
// something. `activate` returns what it saw so the test can assert it.
const vscode = require('vscode');

async function activate() {
  const config = vscode.workspace.getConfiguration('messaging');
  const greeting = config.get('greeting', 'buenas');
  const missing = config.get('nope', 'fallback');

  const picked = await vscode.window.showInformationMessage(
    `${greeting}, mundo`,
    'Sí',
    'No',
  );

  return { greeting, missing, picked, has: config.has('greeting') };
}

module.exports = { activate };
