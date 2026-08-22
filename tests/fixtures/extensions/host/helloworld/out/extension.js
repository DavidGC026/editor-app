'use strict';
// The unmodified VS Code "Hello World" sample, verbatim in shape: this is
// the milestone's exit criterion, so it must not be adapted to Forge.
const vscode = require('vscode');

function activate(context) {
  const disposable = vscode.commands.registerCommand('helloworld.helloWorld', () => {
    vscode.window.showInformationMessage('Hello World from HelloWorld!');
  });

  context.subscriptions.push(disposable);
}

function deactivate() {}

module.exports = { activate, deactivate };
