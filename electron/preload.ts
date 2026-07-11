import { contextBridge, ipcRenderer } from 'electron';

export interface FsChangeEvent {
  reason: 'add' | 'unlink' | 'addDir' | 'unlinkDir' | 'change' | string;
  path: string;
}

export interface ClaudeIdeSelection {
  text: string;
  filePath: string;
  fileUrl: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
    isEmpty: boolean;
  };
}

export interface ClaudeIdeEditorState {
  workspacePath: string | null;
  workspaceName: string | null;
  openEditors: {
    uri: string;
    filePath: string;
    isActive: boolean;
    label: string;
    languageId: string;
    isDirty: boolean;
    lineCount: number;
  }[];
}

export interface ElectronAPI {
  // Dialog
  openFolder: () => Promise<string | null>;
  // File System
  readDirectory: (dirPath: string) => Promise<any[]>;
  readFile: (filePath: string) => Promise<string>;
  readImageDataUrl: (filePath: string) => Promise<{ dataUrl: string; size: number }>;
  writeFile: (filePath: string, content: string) => Promise<boolean>;
  createFile: (filePath: string) => Promise<boolean>;
  createDirectory: (dirPath: string) => Promise<boolean>;
  deleteItem: (itemPath: string) => Promise<boolean>;
  renameItem: (oldPath: string, newPath: string) => Promise<boolean>;
  // Workspace watcher
  watchWorkspace: (dirPath: string) => Promise<boolean>;
  unwatchWorkspace: () => Promise<boolean>;
  onFsChanged: (callback: (event: FsChangeEvent) => void) => void;
  offFsChanged: (callback?: (event: FsChangeEvent) => void) => void;
  onWorkspaceRestore: (callback: (workspacePath: string) => void) => { dispose: () => void };
  // Window Controls
  minimize: () => void;
  maximize: () => void;
  close: () => void;
  // Terminal
  terminalCreate: (opts: { cwd?: string; cols?: number; rows?: number }) => Promise<{ id: string }>;
  terminalWrite: (id: string, data: string) => void;
  terminalResize: (id: string, cols: number, rows: number) => void;
  terminalKill: (id: string) => void;
  terminalSendCommand: (id: string, command: string) => void;
  terminalOnData: (id: string, callback: (data: string) => void) => { dispose: () => void };
  terminalOnExit: (id: string, callback: (code: number) => void) => { dispose: () => void };
  // Clipboard
  readClipboard: () => Promise<string>;
  // Live Server (built-in HTTP server on port 5500)
  liveServer: {
    start: (htmlPath: string) => Promise<{
      active: boolean;
      port: number | null;
      root: string | null;
      htmlFile: string | null;
      url: string | null;
    }>;
    stop: () => Promise<boolean>;
    status: () => Promise<{
      active: boolean;
      port: number | null;
      root: string | null;
      htmlFile: string | null;
      url: string | null;
    }>;
    onStatusChange: (
      callback: (payload: {
        active: boolean;
        port: number | null;
        root: string | null;
        htmlFile: string | null;
        url: string | null;
      }) => void,
    ) => { dispose: () => void };
  };
  // LSP (typescript-language-server)
  lsp: {
    start: (workspacePath: string) => Promise<boolean>;
    stop: () => Promise<boolean>;
    request: (method: string, params: any) => Promise<any>;
    notification: (method: string, params: any) => void;
    /** Subscribe to `textDocument/publishDiagnostics` notifications. */
    onDiagnostics: (callback: (params: any) => void) => { dispose: () => void };
    /** Subscribe to all other LSP notifications (raw method + params). */
    onNotification: (callback: (method: string, params: any) => void) => { dispose: () => void };
  };
  // AI / Agent
  ai: {
    listProviders: () => Promise<any[]>;
    getConfig: () => Promise<{
      configuredProviders: string[];
      activeProvider: string | null;
      activeModel: string | null;
    }>;
    setApiKey: (provider: string, apiKey: string) => Promise<boolean>;
    removeApiKey: (provider: string) => Promise<boolean>;
    setActive: (provider: string, model: string) => Promise<boolean>;
    listModels: (provider: string) => Promise<string[]>;
    chatStream: (args: {
      streamId: string;
      provider: string;
      model: string;
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    }) => Promise<boolean>;
    abortStream: (streamId: string) => Promise<boolean>;
    onStream: (
      streamId: string,
      callback: (event: 'delta' | 'done' | 'error', data: any) => void,
    ) => { dispose: () => void };
  };
  // Extensions (VSIX: themes + snippets)
  ext: {
    installVsix: () => Promise<any | null>;
    list: () => Promise<{ extensions: any[]; activeTheme: string | null }>;
    uninstall: (id: string) => Promise<boolean>;
    setActiveTheme: (themeId: string | null) => Promise<boolean>;
  };
  // Claude Code IDE bridge
  claudeIde: {
    updateEditorState: (state: ClaudeIdeEditorState) => void;
    updateSelection: (selection: ClaudeIdeSelection | null) => void;
    status: () => Promise<Record<string, string>>;
    onCommand: (
      callback: (command: string, args: any) => Promise<any> | any,
    ) => { dispose: () => void };
  };
  // Forge per-project metadata (.forge/)
  forge: {
    readHistory: (workspacePath: string) => Promise<any[] | null>;
    writeHistory: (workspacePath: string, messages: any[]) => Promise<boolean>;
    ensureForgeDir: (workspacePath: string) => Promise<boolean>;
    hasHistory: (workspacePath: string) => Promise<boolean>;
  };
  agent: {
    leerArchivo: (workspacePath: string, ruta: string) => Promise<{
      path: string;
      content: string;
      bytes: number;
    }>;
    escribirArchivo: (
      workspacePath: string,
      ruta: string,
      contenido: string,
    ) => Promise<{ path: string; existed: boolean; bytes: number }>;
    listarCarpeta: (workspacePath: string, ruta: string) => Promise<{
      path: string;
      entries: { name: string; type: 'file' | 'directory' }[];
    }>;
    buscarEnProyecto: (workspacePath: string, texto: string) => Promise<{
      query: string;
      matches: { path: string; line: number; preview: string }[];
      truncated: boolean;
    }>;
    initContext: (workspacePath: string) => Promise<{
      tree: string;
      manifestFiles: { path: string; relPath: string; content: string }[];
    }>;
    snapshotFolder: (
      workspacePath: string,
      folderPath: string,
    ) => Promise<{ path: string; relPath: string; content: string }[]>;
    fileExists: (workspacePath: string, ruta: string) => Promise<boolean>;
    readFileSafe: (workspacePath: string, ruta: string) => Promise<string | null>;
  };
}

// We track the wrapped IPC handlers per user-supplied callback so that
// offFsChanged() can remove the right listener.
const fsChangedHandlers = new WeakMap<
  (event: FsChangeEvent) => void,
  (_event: unknown, payload: FsChangeEvent) => void
>();
const allFsChangedHandlers = new Set<(_event: unknown, payload: FsChangeEvent) => void>();

contextBridge.exposeInMainWorld('electronAPI', {
  // Dialog
  openFolder: () => ipcRenderer.invoke('dialog:openFolder'),
  // File System
  readDirectory: (dirPath: string) => ipcRenderer.invoke('fs:readDirectory', dirPath),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  readImageDataUrl: (filePath: string) =>
    ipcRenderer.invoke('fs:readImageDataUrl', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', filePath, content),
  createFile: (filePath: string) => ipcRenderer.invoke('fs:createFile', filePath),
  createDirectory: (dirPath: string) => ipcRenderer.invoke('fs:createDirectory', dirPath),
  deleteItem: (itemPath: string) => ipcRenderer.invoke('fs:deleteItem', itemPath),
  renameItem: (oldPath: string, newPath: string) => ipcRenderer.invoke('fs:renameItem', oldPath, newPath),
  // Workspace watcher
  watchWorkspace: (dirPath: string) => ipcRenderer.invoke('fs:watch', dirPath),
  unwatchWorkspace: () => ipcRenderer.invoke('fs:unwatch'),
  onFsChanged: (callback: (event: FsChangeEvent) => void) => {
    const handler = (_event: unknown, payload: FsChangeEvent) => {
      try {
        callback(payload);
      } catch (err) {
        console.error('[forge] onFsChanged callback error:', err);
      }
    };
    fsChangedHandlers.set(callback, handler);
    allFsChangedHandlers.add(handler);
    ipcRenderer.on('fs:changed', handler);
  },
  offFsChanged: (callback?: (event: FsChangeEvent) => void) => {
    if (callback) {
      const handler = fsChangedHandlers.get(callback);
      if (handler) {
        ipcRenderer.removeListener('fs:changed', handler);
        fsChangedHandlers.delete(callback);
        allFsChangedHandlers.delete(handler);
      }
    } else {
      // Remove every handler we know about.
      for (const handler of allFsChangedHandlers) {
        ipcRenderer.removeListener('fs:changed', handler);
      }
      allFsChangedHandlers.clear();
    }
  },
  onWorkspaceRestore: (callback: (workspacePath: string) => void) => {
    const channel = 'workspace:restore';
    const handler = (_event: unknown, workspacePath: string) => callback(workspacePath);
    ipcRenderer.on(channel, handler);
    return { dispose: () => ipcRenderer.removeListener(channel, handler) };
  },
  // Window Controls
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.send('window:close'),
  // Terminal
  terminalCreate: (opts: { cwd?: string; cols?: number; rows?: number }) =>
    ipcRenderer.invoke('terminal:create', opts),
  terminalWrite: (id: string, data: string) =>
    ipcRenderer.send('terminal:write', id, data),
  terminalResize: (id: string, cols: number, rows: number) =>
    ipcRenderer.send('terminal:resize', id, cols, rows),
  terminalKill: (id: string) =>
    ipcRenderer.send('terminal:kill', id),
  terminalSendCommand: (id: string, command: string) =>
    ipcRenderer.send('terminal:sendCommand', id, command),
  // Clipboard
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  // ── Live Server ───────────────────────────────────────────────────
  liveServer: {
    start: (htmlPath: string) => ipcRenderer.invoke('liveServer:start', htmlPath),
    stop: () => ipcRenderer.invoke('liveServer:stop'),
    status: () => ipcRenderer.invoke('liveServer:status'),
    onStatusChange: (
      callback: (payload: {
        active: boolean;
        port: number | null;
        root: string | null;
        htmlFile: string | null;
        url: string | null;
      }) => void,
    ) => {
      const channel = 'liveServer:status';
      const handler = (
        _event: unknown,
        payload: {
          active: boolean;
          port: number | null;
          root: string | null;
          htmlFile: string | null;
          url: string | null;
        },
      ) => {
        try {
          callback(payload);
        } catch (err) {
          console.error('[forge] liveServer.onStatusChange callback error:', err);
        }
      };
      ipcRenderer.on(channel, handler);
      return { dispose: () => ipcRenderer.removeListener(channel, handler) };
    },
  },
  terminalOnData: (id: string, callback: (data: string) => void) => {
    const channel = `terminal:data:${id}`;
    const handler = (_event: unknown, data: string) => callback(data);
    ipcRenderer.on(channel, handler);
    return { dispose: () => ipcRenderer.removeListener(channel, handler) };
  },
  terminalOnExit: (id: string, callback: (code: number) => void) => {
    const channel = `terminal:exit:${id}`;
    const handler = (_event: unknown, code: number) => callback(code);
    ipcRenderer.on(channel, handler);
    return { dispose: () => ipcRenderer.removeListener(channel, handler) };
  },
  // LSP — the main process owns the language server process; we just shuttle
  // messages back and forth.
  lsp: {
    start: (workspacePath: string) => ipcRenderer.invoke('lsp:start', workspacePath),
    stop: () => ipcRenderer.invoke('lsp:stop'),
    request: (method: string, params: any) =>
      ipcRenderer.invoke('lsp:request', method, params),
    notification: (method: string, params: any) =>
      ipcRenderer.send('lsp:notification', method, params),
    onDiagnostics: (callback: (params: any) => void) => {
      const channel = 'lsp:notification';
      const handler = (
        _event: unknown,
        payload: { method: string; params: any }
      ) => {
        if (payload && payload.method === 'textDocument/publishDiagnostics') {
          try {
            callback(payload.params);
          } catch (err) {
            console.error('[forge] lsp.onDiagnostics callback error:', err);
          }
        }
      };
      ipcRenderer.on(channel, handler);
      return { dispose: () => ipcRenderer.removeListener(channel, handler) };
    },
    onNotification: (callback: (method: string, params: any) => void) => {
      const channel = 'lsp:notification';
      const handler = (
        _event: unknown,
        payload: { method: string; params: any }
      ) => {
        if (!payload) return;
        try {
          callback(payload.method, payload.params);
        } catch (err) {
          console.error('[forge] lsp.onNotification callback error:', err);
        }
      };
      ipcRenderer.on(channel, handler);
      return { dispose: () => ipcRenderer.removeListener(channel, handler) };
    },
  },
  // ── AI / Agent ────────────────────────────────────────────────────
  ai: {
    listProviders: () => ipcRenderer.invoke('ai:listProviders'),
    getConfig: () => ipcRenderer.invoke('ai:getConfig'),
    setApiKey: (provider: string, apiKey: string) =>
      ipcRenderer.invoke('ai:setApiKey', provider, apiKey),
    removeApiKey: (provider: string) =>
      ipcRenderer.invoke('ai:removeApiKey', provider),
    setActive: (provider: string, model: string) =>
      ipcRenderer.invoke('ai:setActive', provider, model),
    listModels: (provider: string) =>
      ipcRenderer.invoke('ai:listModels', provider),
    chatStream: (args: {
      streamId: string;
      provider: string;
      model: string;
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
    }) => ipcRenderer.invoke('ai:chatStream', args),
    abortStream: (streamId: string) =>
      ipcRenderer.invoke('ai:abortStream', streamId),
    onStream: (
      streamId: string,
      callback: (event: 'delta' | 'done' | 'error', data: any) => void,
    ) => {
      const channel = `ai:stream:${streamId}`;
      const handler = (
        _event: unknown,
        payload: { event: 'delta' | 'done' | 'error'; data: any },
      ) => {
        try {
          callback(payload.event, payload.data);
        } catch (err) {
          console.error('[forge] ai.onStream callback error:', err);
        }
      };
      ipcRenderer.on(channel, handler);
      return { dispose: () => ipcRenderer.removeListener(channel, handler) };
    },
  },
  // ── Extensions (VSIX) ─────────────────────────────────────────────
  ext: {
    installVsix: () => ipcRenderer.invoke('ext:installVsix'),
    list: () => ipcRenderer.invoke('ext:list'),
    uninstall: (id: string) => ipcRenderer.invoke('ext:uninstall', id),
    setActiveTheme: (themeId: string | null) =>
      ipcRenderer.invoke('ext:setActiveTheme', themeId),
  },
  // ── Claude Code IDE bridge ────────────────────────────────────────
  claudeIde: {
    updateEditorState: (state: ClaudeIdeEditorState) =>
      ipcRenderer.send('claude:editorStateChanged', state),
    updateSelection: (selection: ClaudeIdeSelection | null) =>
      ipcRenderer.send('claude:selectionChanged', selection),
    status: () => ipcRenderer.invoke('claude:status'),
    onCommand: (
      callback: (command: string, args: any) => Promise<any> | any,
    ) => {
      const channel = 'claude:renderer-request';
      const handler = async (
        _event: unknown,
        payload: { id: number; command: string; args: any },
      ) => {
        if (!payload || typeof payload.id !== 'number') return;
        try {
          const result = await callback(payload.command, payload.args);
          ipcRenderer.send('claude:renderer-response', {
            id: payload.id,
            ok: true,
            result,
          });
        } catch (err) {
          ipcRenderer.send('claude:renderer-response', {
            id: payload.id,
            ok: false,
            error: (err as Error)?.message || String(err),
          });
        }
      };
      ipcRenderer.on(channel, handler);
      return { dispose: () => ipcRenderer.removeListener(channel, handler) };
    },
  },
  // ── Forge per-project metadata (.forge/) ──────────────────────────
  forge: {
    readHistory: (workspacePath: string) =>
      ipcRenderer.invoke('forge:readHistory', workspacePath),
    writeHistory: (workspacePath: string, messages: any[]) =>
      ipcRenderer.invoke('forge:writeHistory', workspacePath, messages),
    ensureForgeDir: (workspacePath: string) =>
      ipcRenderer.invoke('forge:ensureForgeDir', workspacePath),
    hasHistory: (workspacePath: string) =>
      ipcRenderer.invoke('forge:hasHistory', workspacePath),
  },
  agent: {
    leerArchivo: (workspacePath: string, ruta: string) =>
      ipcRenderer.invoke('agent:leerArchivo', workspacePath, ruta),
    escribirArchivo: (workspacePath: string, ruta: string, contenido: string) =>
      ipcRenderer.invoke('agent:escribirArchivo', workspacePath, ruta, contenido),
    listarCarpeta: (workspacePath: string, ruta: string) =>
      ipcRenderer.invoke('agent:listarCarpeta', workspacePath, ruta),
    buscarEnProyecto: (workspacePath: string, texto: string) =>
      ipcRenderer.invoke('agent:buscarEnProyecto', workspacePath, texto),
    initContext: (workspacePath: string) =>
      ipcRenderer.invoke('agent:initContext', workspacePath),
    snapshotFolder: (workspacePath: string, folderPath: string) =>
      ipcRenderer.invoke('agent:snapshotFolder', workspacePath, folderPath),
    fileExists: (workspacePath: string, ruta: string) =>
      ipcRenderer.invoke('agent:fileExists', workspacePath, ruta),
    readFileSafe: (workspacePath: string, ruta: string) =>
      ipcRenderer.invoke('agent:readFileSafe', workspacePath, ruta),
  },
} as ElectronAPI);
