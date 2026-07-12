import React, { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { Bug, Plus, RotateCcw, Play, Pencil, Trash2, Save, XCircle, Package, Terminal as TerminalIcon } from 'lucide-react';

interface RunCommand {
  id: string;
  label: string;
  command: string;
}

interface PackageScript {
  name: string;
  command: string;
}

function joinPath(parent: string, name: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.endsWith(sep) ? `${parent}${name}` : `${parent}${sep}${name}`;
}

async function detectPackageManager(workspacePath: string): Promise<'pnpm' | 'npm' | 'yarn' | 'bun'> {
  const exists = async (name: string) => {
    try {
      // @ts-ignore
      const content = await window.electronAPI.agent.readFileSafe(workspacePath, joinPath(workspacePath, name));
      return content !== null;
    } catch {
      return false;
    }
  };
  if (await exists('pnpm-lock.yaml')) return 'pnpm';
  if (await exists('bun.lockb')) return 'bun';
  if (await exists('bun.lock')) return 'bun';
  if (await exists('yarn.lock')) return 'yarn';
  return 'npm';
}

function scriptCommandFor(pm: 'pnpm' | 'npm' | 'yarn' | 'bun', name: string): string {
  if (pm === 'npm') return `npm run ${name}`;
  if (pm === 'yarn') return `yarn ${name}`;
  if (pm === 'bun') return `bun run ${name}`;
  return `pnpm run ${name}`;
}

const RUN_COMMANDS_STORAGE_KEY = 'forge.runCommands.v1';
const DEFAULT_RUN_COMMANDS: RunCommand[] = [
  { id: 'npm-dev', label: 'npm run dev', command: 'npm run dev' },
  { id: 'npm-test', label: 'npm test', command: 'npm test' },
  { id: 'npm-build', label: 'npm run build', command: 'npm run build' },
  { id: 'npm-start', label: 'npm start', command: 'npm start' },
  { id: 'pnpm-dev', label: 'pnpm dev', command: 'pnpm dev' },
  { id: 'pnpm-run', label: 'pnpm run', command: 'pnpm run' },
  { id: 'pnpm-start', label: 'pnpm start', command: 'pnpm start' },
  { id: 'pnpm-package', label: 'pnpm package', command: 'pnpm package' },
  { id: 'pnpm-build', label: 'pnpm build', command: 'pnpm build' },
];

function loadRunCommands(): RunCommand[] {
  try {
    const raw = window.localStorage.getItem(RUN_COMMANDS_STORAGE_KEY);
    if (!raw) return DEFAULT_RUN_COMMANDS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_RUN_COMMANDS;
    const commands = parsed
      .filter((item) => item && typeof item.label === 'string' && typeof item.command === 'string')
      .map((item) => ({
        id: typeof item.id === 'string' ? item.id : `cmd-${Date.now()}`,
        label: item.label,
        command: item.command,
      }))
      .filter((item) => item.label.trim() && item.command.trim());
    return commands.length > 0 ? commands : DEFAULT_RUN_COMMANDS;
  } catch {
    return DEFAULT_RUN_COMMANDS;
  }
}

function saveRunCommands(commands: RunCommand[]): void {
  try {
    window.localStorage.setItem(RUN_COMMANDS_STORAGE_KEY, JSON.stringify(commands));
  } catch {
    /* best-effort */
  }
}

export default function RunDebugPanel() {
  const workspacePath = useStore((s) => s.workspacePath);
  const runCommandInTerminal = useStore((s) => s.runCommandInTerminal);
  const runAgentInTerminal = useStore((s) => s.runAgentInTerminal);
  const [commands, setCommands] = useState<RunCommand[]>(() => loadRunCommands());
  const [packageScripts, setPackageScripts] = useState<PackageScript[]>([]);
  const [packageManager, setPackageManager] = useState<'pnpm' | 'npm' | 'yarn' | 'bun'>('pnpm');
  const [packageError, setPackageError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftCommand, setDraftCommand] = useState('');

  useEffect(() => {
    saveRunCommands(commands);
  }, [commands]);

  useEffect(() => {
    let cancelled = false;
    if (!workspacePath) {
      setPackageScripts([]);
      setPackageError(null);
      return;
    }

    const packagePath = joinPath(workspacePath, 'package.json');
    Promise.all([
      // @ts-ignore
      window.electronAPI.readFile(packagePath),
      detectPackageManager(workspacePath),
    ])
      .then(([text, pm]) => {
        if (cancelled) return;
        setPackageManager(pm);
        const parsed = JSON.parse(text);
        const scripts = parsed?.scripts && typeof parsed.scripts === 'object'
          ? Object.entries(parsed.scripts)
            .filter((entry): entry is [string, string] => (
              typeof entry[0] === 'string' && typeof entry[1] === 'string'
            ))
            .map(([name]) => ({ name, command: scriptCommandFor(pm, name) }))
          : [];
        setPackageScripts(scripts);
        setPackageError(null);
      })
      .catch(() => {
        if (cancelled) return;
        setPackageScripts([]);
        setPackageError(null);
      });

    return () => { cancelled = true; };
  }, [workspacePath]);

  const beginEdit = (command: RunCommand) => {
    setEditingId(command.id);
    setDraftLabel(command.label);
    setDraftCommand(command.command);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const label = draftLabel.trim();
    const command = draftCommand.trim();
    if (!label || !command) return;
    setCommands((prev) =>
      prev.map((item) => item.id === editingId ? { ...item, label, command } : item),
    );
    setEditingId(null);
  };

  const addCommand = () => {
    const next: RunCommand = {
      id: `cmd-${Date.now()}`,
      label: 'New command',
      command: 'echo hello',
    };
    setCommands((prev) => [...prev, next]);
    beginEdit(next);
  };

  const deleteCommand = (id: string) => {
    setCommands((prev) => prev.filter((item) => item.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const resetCommands = () => {
    setCommands(DEFAULT_RUN_COMMANDS);
    setEditingId(null);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <span>Run and Debug</span>
        <span className="flex items-center gap-1">
          <button
            onClick={addCommand}
            title="Add command"
            className="text-forge-text hover:text-forge-accent"
          >
            <Plus size={13} />
          </button>
          <button
            onClick={resetCommands}
            title="Restore defaults"
            className="text-forge-text hover:text-forge-accent"
          >
            <RotateCcw size={13} />
          </button>
        </span>
      </div>

      {!workspacePath ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center text-forge-text">
          <Bug size={36} className="text-forge-text/50" />
          <p className="text-sm">Open a folder to run commands</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto sidebar-scroll px-3 pb-4">
          {packageScripts.length > 0 && (
            <>
              <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
                <span>Package Scripts</span>
                <span className="text-forge-text/35 normal-case">{packageManager}</span>
                <span>{packageScripts.length}</span>
              </div>
              <div className="space-y-1 mb-4">
                {packageScripts.map((script) => (
                  <button
                    key={script.name}
                    onClick={() => runCommandInTerminal(script.command)}
                    className="w-full flex items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/5 transition-colors"
                  >
                    <span className="w-7 h-7 rounded bg-forge-accent/10 text-forge-accent border border-forge-accent/20 flex items-center justify-center flex-shrink-0">
                      <Package size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-forge-text-strong truncate">
                        {script.name}
                      </span>
                      <span className="block text-[10px] text-forge-text/45 truncate">
                        {script.command}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {packageError && (
            <p className="mb-3 text-[11px] text-red-400/90">{packageError}</p>
          )}

          <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
            <span>Commands</span>
            <span>{commands.length}</span>
          </div>
          <div className="space-y-1">
            {commands.map((cmd) => {
              const isEditing = editingId === cmd.id;
              if (isEditing) {
                return (
                  <div
                    key={cmd.id}
                    className="rounded border border-forge-accent/40 bg-forge-input/50 p-2"
                  >
                    <input
                      value={draftLabel}
                      onChange={(e) => setDraftLabel(e.target.value)}
                      placeholder="Label"
                      className="w-full bg-forge-input text-forge-text text-[12px] px-2 py-1 rounded outline-none border border-transparent focus:border-forge-accent/60"
                    />
                    <input
                      value={draftCommand}
                      onChange={(e) => setDraftCommand(e.target.value)}
                      placeholder="Command"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveEdit();
                        if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="mt-1.5 w-full bg-forge-input text-forge-text text-[12px] px-2 py-1 rounded outline-none border border-transparent focus:border-forge-accent/60"
                    />
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <button
                        onClick={() => setEditingId(null)}
                        className="w-7 h-6 flex items-center justify-center rounded text-forge-text hover:bg-white/5"
                        title="Cancel"
                      >
                        <XCircle size={13} />
                      </button>
                      <button
                        onClick={saveEdit}
                        disabled={!draftLabel.trim() || !draftCommand.trim()}
                        className="w-7 h-6 flex items-center justify-center rounded text-forge-accent hover:bg-forge-accent/10 disabled:opacity-40"
                        title="Save"
                      >
                        <Save size={13} />
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={cmd.id}
                  className="group flex items-center gap-2 rounded px-2 py-2 hover:bg-white/5 transition-colors"
                >
                  <button
                    onClick={() => runCommandInTerminal(cmd.command)}
                    className="flex items-center gap-2 text-left min-w-0 flex-1"
                  >
                    <span className="w-7 h-7 rounded bg-forge-accent/10 text-forge-accent border border-forge-accent/20 flex items-center justify-center flex-shrink-0">
                      <Play size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] text-forge-text-strong truncate">
                        {cmd.label}
                      </span>
                      <span className="block text-[10px] text-forge-text/45 truncate">
                        {cmd.command}
                      </span>
                    </span>
                  </button>
                  <button
                    onClick={() => beginEdit(cmd)}
                    className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-forge-accent"
                    title="Edit command"
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    onClick={() => deleteCommand(cmd.id)}
                    className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-red-400"
                    title="Delete command"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-4 text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
            Agents
          </div>
          <div className="space-y-1">
            {[
              ['Codex', 'codex'],
              ['Claude Code', 'claude'],
              ['Cursor Agent', 'cursor-agent'],
              ['Antigravity', 'agy'],
            ].map(([label, command]) => (
              <button
                key={command}
                onClick={() => runAgentInTerminal(command as import('../../types').AgentTerminalId)}
                className="w-full flex items-center gap-2 rounded px-2 py-2 text-left hover:bg-white/5 transition-colors"
              >
                <span className="w-7 h-7 rounded bg-forge-input border border-forge-border/60 text-forge-accent flex items-center justify-center flex-shrink-0">
                  <TerminalIcon size={14} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] text-forge-text-strong truncate">
                    {label}
                  </span>
                  <span className="block text-[10px] text-forge-text/45 truncate">
                    {command}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
