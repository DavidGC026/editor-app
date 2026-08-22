'use strict';
// Registers a disposable *before* failing: the runtime must still release it.
const vscode = require('vscode');

const released = [];

function activate(context) {
  context.subscriptions.push(new vscode.Disposable(() => released.push('released')));
  throw new Error('la extensión revienta a propósito');
}

module.exports = { activate, released };
