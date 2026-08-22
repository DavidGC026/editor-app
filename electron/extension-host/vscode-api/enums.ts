/**
 * Enum-shaped constants of the `vscode` API.
 *
 * They are frozen objects, not TypeScript `enum`s: the modules of this
 * subsystem are also loaded by `node --test` through type stripping, which
 * rejects non-erasable syntax. The runtime shape an extension sees is the
 * same either way — `vscode.ExtensionMode.Production === 1`.
 *
 * Only enums that extensions read *before* the API that uses them exists are
 * here. Anything belonging to a namespace still answering `UNSUPPORTED_API`
 * (debug, notebooks, tests) is deliberately absent: a value without its API
 * is a trap, not a courtesy.
 */

export const ExtensionMode = Object.freeze({
  Production: 1,
  Development: 2,
  Test: 3,
} as const);

export const ExtensionKind = Object.freeze({
  UI: 1,
  Workspace: 2,
} as const);

export const ConfigurationTarget = Object.freeze({
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const);

export const ViewColumn = Object.freeze({
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9,
} as const);

export const StatusBarAlignment = Object.freeze({
  Left: 1,
  Right: 2,
} as const);

export const DiagnosticSeverity = Object.freeze({
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3,
} as const);

export const LogLevel = Object.freeze({
  Off: 0,
  Trace: 1,
  Debug: 2,
  Info: 3,
  Warning: 4,
  Error: 5,
} as const);

export const UIKind = Object.freeze({
  Desktop: 1,
  Web: 2,
} as const);

export const EndOfLine = Object.freeze({
  LF: 1,
  CRLF: 2,
} as const);

export const FileType = Object.freeze({
  Unknown: 0,
  File: 1,
  Directory: 2,
  SymbolicLink: 64,
} as const);

/** Every enum, keyed as the `vscode` namespace exposes them. */
export const VSCODE_ENUMS = Object.freeze({
  ExtensionMode,
  ExtensionKind,
  ConfigurationTarget,
  ViewColumn,
  StatusBarAlignment,
  DiagnosticSeverity,
  LogLevel,
  UIKind,
  EndOfLine,
  FileType,
});

export type ExtensionModeValue = (typeof ExtensionMode)[keyof typeof ExtensionMode];
