'use strict';
// Uses an API that does not exist yet. Feature detection must still see a
// function; only calling it fails.
const vscode = require('vscode');

function activate() {
  if (typeof vscode.commands.registerCommand !== 'function') {
    throw new Error('la detección de características no debería fallar');
  }
  return vscode.commands.registerCommand('fixture.nope', () => undefined);
}

module.exports = { activate };
