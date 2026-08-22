'use strict';
// Sane extension: touches the primitives, records what it saw and cleans up.
const vscode = require('vscode');

const trace = [];

function activate(context) {
  trace.push('activate');
  const emitter = new vscode.EventEmitter();
  emitter.event((value) => trace.push(`event:${value}`));
  emitter.fire('ping');

  context.subscriptions.push(emitter);
  context.subscriptions.push(new vscode.Disposable(() => trace.push('disposed')));
  context.globalState.update('runs', (context.globalState.get('runs', 0)) + 1);

  return {
    trace,
    version: vscode.version,
    uri: vscode.Uri.joinPath(context.extensionUri, 'out').toString(),
    mode: context.extensionMode,
  };
}

function deactivate() {
  trace.push('deactivate');
}

module.exports = { activate, deactivate, trace };
