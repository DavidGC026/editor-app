'use strict';
// Uses an API that does not exist yet. Feature detection must still see a
// function; only calling it fails.
const vscode = require('vscode');

function activate() {
  if (typeof vscode.window.createStatusBarItem !== 'function') {
    throw new Error('la detección de características no debería fallar');
  }
  return vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
}

module.exports = { activate };
