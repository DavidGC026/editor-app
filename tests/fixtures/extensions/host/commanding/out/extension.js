'use strict';
// Registers commands the way a real extension does: through
// `context.subscriptions`, so deactivation unwinds them for free.
const vscode = require('vscode');

const calls = [];

function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('fixture.greet', (name) => {
      calls.push(name);
      return `hola, ${name ?? 'mundo'}`;
    }),
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('fixture.explode', () => {
      throw new Error('el comando revienta');
    }),
  );
  // Not disposed on purpose: deactivate() must clean it up anyway.
  vscode.commands.registerCommand('fixture.leaked', () => 'leaked');
}

module.exports = { activate, calls };
