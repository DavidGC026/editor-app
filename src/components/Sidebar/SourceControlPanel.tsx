import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { generateCommitMessage } from '../../ai/quickActions';
import { gitStatusLabel, gitStatusTitle, isStaged, isUnstaged } from '../../utils/gitHelpers';
import { FileCode2, RotateCcw, Plus, Sparkles, GitBranch, RefreshCw, CheckCircle2, Bot, PlusCircle, MinusCircle, History, Hammer, Trash2, ArrowUp, ArrowDown, UploadCloud, File, Folder, Github, XCircle, LogOut, Copy, ExternalLink, Loader2, GitCommit } from 'lucide-react';
import type { GitChange } from '../../types';

function GithubAuthModal({ onClose }: { onClose: () => void }) {
  const [auth, setAuth] = useState<{
    authenticated: boolean;
    login: string | null;
    clientId: string | null;
  } | null>(null);
  const [clientIdInput, setClientIdInput] = useState('');
  const [flow, setFlow] = useState<{ userCode: string; verificationUri: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void window.electronAPI.github.getAuth().then((a) => {
      setAuth(a);
      setClientIdInput(a.clientId || '');
    });
  }, []);

  const close = () => {
    if (flow) void window.electronAPI.github.cancelDeviceFlow();
    onClose();
  };

  const startLogin = async () => {
    const clientId = clientIdInput.trim();
    if (!clientId) {
      setError('Introduce el Client ID de tu OAuth App.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (clientId !== auth?.clientId) {
        await window.electronAPI.github.setClientId(clientId);
      }
      const f = await window.electronAPI.github.startDeviceFlow();
      setFlow(f);
      void navigator.clipboard.writeText(f.userCode);
      void window.electronAPI.openExternal(f.verificationUri);
      const { login } = await window.electronAPI.github.waitForToken();
      setFlow(null);
      setAuth({ authenticated: true, login, clientId });
    } catch (err) {
      setFlow(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    await window.electronAPI.github.logout();
    setAuth((a) => (a ? { ...a, authenticated: false, login: null } : a));
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="w-[380px] max-w-[90vw] bg-forge-sidebar border border-forge-border rounded-lg p-4 text-forge-text shadow-xl">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold">
            <Github size={16} />
            GitHub
          </div>
          <button onClick={close} className="text-forge-text/60 hover:text-forge-text">
            <XCircle size={16} />
          </button>
        </div>

        {auth?.authenticated ? (
          <div className="space-y-3">
            <p className="text-[12px]">
              Conectado como <span className="text-forge-accent font-semibold">{auth.login}</span>.
              El push y pull por HTTPS ya funcionan.
            </p>
            <button
              onClick={() => void logout()}
              className="flex items-center gap-2 px-3 py-1.5 rounded bg-forge-accent/15 text-forge-accent text-[12px] hover:bg-forge-accent/25"
            >
              <LogOut size={13} />
              Cerrar sesión
            </button>
          </div>
        ) : flow ? (
          <div className="space-y-3 text-[12px]">
            <p>Introduce este código en GitHub (ya está copiado al portapapeles):</p>
            <div className="flex items-center justify-center gap-2">
              <span className="text-[20px] font-mono font-bold tracking-widest text-forge-accent">
                {flow.userCode}
              </span>
              <button
                onClick={() => void navigator.clipboard.writeText(flow.userCode)}
                title="Copiar código"
                className="text-forge-text/60 hover:text-forge-accent"
              >
                <Copy size={14} />
              </button>
            </div>
            <button
              onClick={() => void window.electronAPI.openExternal(flow.verificationUri)}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-forge-accent/15 text-forge-accent hover:bg-forge-accent/25"
            >
              <ExternalLink size={13} />
              Abrir {flow.verificationUri.replace('https://', '')}
            </button>
            <p className="flex items-center gap-2 text-forge-text/60">
              <Loader2 size={13} className="animate-spin" />
              Esperando autorización en GitHub…
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-[12px]">
            <p className="text-forge-text/80 leading-snug">
              Inicia sesión con OAuth (device flow) para que push/pull por HTTPS
              funcionen como en VS Code. Necesitas una OAuth App propia:{' '}
              <button
                onClick={() =>
                  void window.electronAPI.openExternal(
                    'https://github.com/settings/applications/new',
                  )
                }
                className="text-forge-accent hover:underline"
              >
                créala aquí
              </button>{' '}
              (cualquier callback URL sirve) y marca{' '}
              <span className="font-semibold">"Enable Device Flow"</span>.
            </p>
            <input
              value={clientIdInput}
              onChange={(e) => setClientIdInput(e.target.value)}
              placeholder="Client ID de la OAuth App (p. ej. Iv1.abc123…)"
              spellCheck={false}
              className="w-full bg-forge-input text-forge-text text-[12px] px-2 py-1.5 rounded outline-none border border-transparent focus:border-forge-accent/60"
            />
            <button
              onClick={() => void startLogin()}
              disabled={busy || !clientIdInput.trim()}
              className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded bg-forge-accent/15 text-forge-accent hover:bg-forge-accent/25 disabled:opacity-40"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Github size={13} />}
              Conectar con GitHub
            </button>
          </div>
        )}

        {error && (
          <p className="mt-3 text-[11px] leading-snug text-red-400/90 whitespace-pre-wrap">{error}</p>
        )}
      </div>
    </div>
  );
}

export default function SourceControlPanel() {
  const workspacePath = useStore((s) => s.workspacePath);
  const gitIsRepo = useStore((s) => s.gitIsRepo);
  const gitBranch = useStore((s) => s.gitBranch);
  const gitBranches = useStore((s) => s.gitBranches);
  const gitChanges = useStore((s) => s.gitChanges);
  const gitBusy = useStore((s) => s.gitBusy);
  const gitSyncBusy = useStore((s) => s.gitSyncBusy);
  const gitError = useStore((s) => s.gitError);
  const gitAhead = useStore((s) => s.gitAhead);
  const gitBehind = useStore((s) => s.gitBehind);
  const gitHasUpstream = useStore((s) => s.gitHasUpstream);
  const gitHasRemote = useStore((s) => s.gitHasRemote);
  const refreshGitStatus = useStore((s) => s.refreshGitStatus);
  const gitStageFiles = useStore((s) => s.gitStageFiles);
  const gitUnstageFiles = useStore((s) => s.gitUnstageFiles);
  const gitCommitChanges = useStore((s) => s.gitCommitChanges);
  const gitDiscardFiles = useStore((s) => s.gitDiscardFiles);
  const gitPushChanges = useStore((s) => s.gitPushChanges);
  const gitPullChanges = useStore((s) => s.gitPullChanges);
  const gitCheckoutBranch = useStore((s) => s.gitCheckoutBranch);
  const gitCreateBranch = useStore((s) => s.gitCreateBranch);
  const openFilePath = useStore((s) => s.openFilePath);
  const openGitDiff = useStore((s) => s.openGitDiff);
  const runCommandInTerminal = useStore((s) => s.runCommandInTerminal);
  const runAgentInTerminal = useStore((s) => s.runAgentInTerminal);

  const [message, setMessage] = useState('');
  const [aiMsgBusy, setAiMsgBusy] = useState(false);
  const [aiMsgError, setAiMsgError] = useState<string | null>(null);
  const [githubModalOpen, setGithubModalOpen] = useState(false);
  const [branchDraft, setBranchDraft] = useState('');

  useEffect(() => {
    void refreshGitStatus();
  }, [refreshGitStatus, workspacePath]);

  const staged = gitChanges.filter(isStaged);
  const unstaged = gitChanges.filter((change) => !isStaged(change) || isUnstaged(change));
  const anyBusy = gitBusy || gitSyncBusy;
  // Como en VS Code: si no hay nada en staged, el commit prepara todos los
  // cambios automáticamente.
  const canCommit = gitChanges.length > 0 && message.trim().length > 0 && !anyBusy;

  const openChangeDiff = (change: GitChange, mode: 'unstaged' | 'staged') => {
    void openGitDiff(change.relPath, mode === 'staged');
  };

  const openChangeFile = (change: GitChange) => {
    if (!workspacePath) return;
    void openFilePath(joinPath(workspacePath, change.relPath));
  };

  const commit = async () => {
    if (!canCommit) return;
    if (staged.length === 0) {
      await gitStageFiles(gitChanges.map((c) => c.relPath));
      if (useStore.getState().gitError) return;
    }
    const ok = await gitCommitChanges(message.trim());
    if (ok) setMessage('');
  };

  const generateMessage = async () => {
    if (aiMsgBusy || gitChanges.length === 0) return;
    setAiMsgBusy(true);
    setAiMsgError(null);
    try {
      setMessage(await generateCommitMessage());
    } catch (err) {
      setAiMsgError((err as Error).message);
    } finally {
      setAiMsgBusy(false);
    }
  };

  const push = async () => {
    if (anyBusy) return;
    await gitPushChanges();
  };

  const pull = async () => {
    if (anyBusy) return;
    await gitPullChanges();
  };

  const checkoutBranch = async (name: string) => {
    if (!name || name === gitBranch) return;
    if (gitChanges.length > 0) {
      const ok = confirm('Hay cambios sin commit. Cambiar de rama puede fallar o requerir stash. ¿Continuar?');
      if (!ok) return;
    }
    await gitCheckoutBranch(name);
  };

  const createBranch = async () => {
    const name = branchDraft.trim();
    if (!name) return;
    const ok = await gitCreateBranch(name);
    if (ok) setBranchDraft('');
  };

  const renderChange = (change: GitChange, mode: 'unstaged' | 'staged') => (
    <div
      key={`${mode}-${change.relPath}-${change.x}-${change.y}`}
      className="group flex items-center gap-2 h-[28px] px-2 rounded hover:bg-white/5 text-[12px]"
    >
      <button
        onClick={() => openChangeDiff(change, mode)}
        title={`${change.relPath} — clic para diff, icono derecho para abrir archivo`}
        className="flex items-center gap-2 min-w-0 flex-1 text-left"
      >
        <span
          className="w-5 h-5 rounded bg-forge-input border border-forge-border/60 flex items-center justify-center text-[10px] text-forge-accent flex-shrink-0"
          title={gitStatusTitle(change)}
        >
          {gitStatusLabel(change)}
        </span>
        <span className="truncate text-forge-text">{change.relPath}</span>
      </button>
      <button
        onClick={() => openChangeFile(change)}
        disabled={gitBusy}
        title="Open file"
        className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-forge-accent disabled:opacity-30"
      >
        <FileCode2 size={14} />
      </button>
      {mode === 'unstaged' ? (
        <>
          <button
            onClick={() => {
              if (confirm(`¿Descartar los cambios de "${change.relPath}"? Esta acción no se puede deshacer.`)) {
                void gitDiscardFiles([change.relPath]);
              }
            }}
            disabled={gitBusy}
            title="Discard Changes"
            className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-red-400 disabled:opacity-30"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={() => void gitStageFiles([change.relPath])}
            disabled={gitBusy}
            title="Stage"
            className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-forge-accent disabled:opacity-30"
          >
            <PlusCircle size={14} />
          </button>
        </>
      ) : (
        <button
          onClick={() => void gitUnstageFiles([change.relPath])}
          disabled={gitBusy}
          title="Unstage"
          className="opacity-0 group-hover:opacity-100 text-forge-text hover:text-forge-accent disabled:opacity-30"
        >
          <MinusCircle size={14} />
        </button>
      )}
    </div>
  );

  if (!workspacePath) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-forge-text">
        <GitBranch size={36} className="text-forge-text/60" />
        <p className="text-sm text-center">Open a folder to use Source Control</p>
      </div>
    );
  }

  if (!gitIsRepo) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
          <span>Source Control</span>
          <button
            onClick={() => void refreshGitStatus()}
            title="Refresh"
            className="text-forge-text hover:text-forge-accent"
          >
            <RefreshCw size={13} className={gitBusy ? 'animate-spin' : ''} />
          </button>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center text-forge-text">
          <GitBranch size={36} className="text-forge-text/50" />
          <p className="text-sm">This folder is not a Git repository</p>
          <button
            onClick={() => runCommandInTerminal('git init')}
            className="px-3 py-1.5 rounded bg-forge-accent/15 text-forge-accent text-[12px] hover:bg-forge-accent/25"
          >
            Initialize Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="h-[35px] flex items-center justify-between px-4 text-[11px] uppercase tracking-wide text-forge-text/70 flex-shrink-0">
        <span>Source Control</span>
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setGithubModalOpen(true)}
            title="GitHub — iniciar sesión (OAuth)"
            className="text-forge-text hover:text-forge-accent"
          >
            <Github size={13} />
          </button>
          <button
            onClick={() => void pull()}
            disabled={anyBusy || !gitHasUpstream}
            title={gitHasUpstream ? 'Pull' : 'Pull (sin upstream)'}
            className="text-forge-text hover:text-forge-accent disabled:opacity-30"
          >
            <ArrowDown size={13} />
          </button>
          <button
            onClick={() => void push()}
            disabled={anyBusy || !gitHasRemote}
            title={gitHasRemote ? 'Push' : 'Push (sin remoto configurado)'}
            className="text-forge-text hover:text-forge-accent disabled:opacity-30"
          >
            <ArrowUp size={13} />
          </button>
          <button
            onClick={() => void refreshGitStatus()}
            title="Refresh"
            className="text-forge-text hover:text-forge-accent"
          >
            <RefreshCw size={13} className={anyBusy ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="px-3 pb-3 flex-shrink-0">
        <div className="flex items-center gap-2 text-[12px] text-forge-text/70 mb-2">
          <GitBranch size={13} className="text-forge-accent" />
          <select
            value={gitBranch || ''}
            onChange={(e) => void checkoutBranch(e.target.value)}
            disabled={anyBusy || gitBranches.length === 0}
            className="min-w-0 max-w-[150px] bg-forge-input text-forge-text text-[12px] px-1.5 py-0.5 rounded border border-forge-border/60 outline-none focus:border-forge-accent/60 disabled:opacity-60"
            title="Checkout branch"
          >
            <option value={gitBranch || ''}>{gitBranch || 'HEAD'}</option>
            {gitBranches
              .filter((branch) => branch.name !== gitBranch)
              .map((branch) => (
                <option key={`${branch.remote ? 'r' : 'l'}-${branch.name}`} value={branch.name}>
                  {branch.remote ? `remote: ${branch.name}` : branch.name}
                </option>
              ))}
          </select>
          {gitHasUpstream && (gitAhead > 0 || gitBehind > 0) && (
            <span
              className="flex items-center gap-0.5 text-[11px] text-forge-text/60"
              title={`${gitBehind} por descargar · ${gitAhead} por subir`}
            >
              {gitBehind > 0 && (
                <>
                  {gitBehind}
                  <ArrowDown size={11} />
                </>
              )}
              {gitAhead > 0 && (
                <>
                  {gitAhead}
                  <ArrowUp size={11} />
                </>
              )}
            </span>
          )}
          <span className="text-forge-text/35">·</span>
          <span className="text-forge-text/50">{gitChanges.length} changes</span>
        </div>
        <div className="mb-2 flex items-center gap-1">
          <input
            value={branchDraft}
            onChange={(e) => setBranchDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createBranch();
              if (e.key === 'Escape') setBranchDraft('');
            }}
            placeholder="new-branch"
            disabled={anyBusy}
            spellCheck={false}
            className="min-w-0 flex-1 bg-forge-input text-forge-text text-[11px] px-2 py-1 rounded outline-none border border-transparent focus:border-forge-accent/60 disabled:opacity-60"
          />
          <button
            onClick={() => void createBranch()}
            disabled={anyBusy || !branchDraft.trim()}
            title="Create and checkout branch"
            className="w-7 h-6 flex items-center justify-center rounded text-forge-text hover:text-forge-accent hover:bg-white/5 disabled:opacity-30"
          >
            <Plus size={13} />
          </button>
        </div>
        <div className="relative">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Message (Ctrl+Enter to commit)"
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault();
                void commit();
              }
            }}
            className="w-full h-[64px] resize-none bg-forge-input text-forge-text text-[12px] pl-2 pr-7 py-1.5 rounded outline-none border border-transparent focus:border-forge-accent/60"
          />
          <button
            onClick={() => void generateMessage()}
            disabled={aiMsgBusy || gitChanges.length === 0}
            title="Generar mensaje de commit con IA"
            className="absolute top-1.5 right-1.5 text-forge-text/50 hover:text-forge-accent disabled:opacity-30"
          >
            {aiMsgBusy ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Sparkles size={14} />
            )}
          </button>
        </div>
        {aiMsgError && (
          <p className="mt-1 text-[11px] leading-snug text-red-400/90">{aiMsgError}</p>
        )}
        <button
          onClick={() => void commit()}
          disabled={!canCommit}
          className="mt-1.5 w-full flex items-center justify-center gap-2 rounded bg-forge-accent/15 text-forge-accent text-[12px] py-1.5 hover:bg-forge-accent/25 disabled:opacity-40 disabled:hover:bg-forge-accent/15"
        >
          <GitCommit size={13} />
          {staged.length > 0 ? 'Commit Staged' : 'Commit All'}
        </button>
        {gitHasRemote && !gitHasUpstream && (
          <button
            onClick={() => void push()}
            disabled={anyBusy}
            className="mt-1.5 w-full flex items-center justify-center gap-2 rounded bg-forge-accent/15 text-forge-accent text-[12px] py-1.5 hover:bg-forge-accent/25 disabled:opacity-40 disabled:hover:bg-forge-accent/15"
          >
            {gitSyncBusy ? <Loader2 size={13} className="animate-spin" /> : <UploadCloud size={13} />}
            Publish Branch
          </button>
        )}
        {gitHasUpstream && (gitAhead > 0 || gitBehind > 0) && (
          <button
            onClick={() => {
              void (async () => {
                if (gitBehind > 0) {
                  const ok = await gitPullChanges();
                  if (!ok) return;
                }
                if (useStore.getState().gitAhead > 0) await gitPushChanges();
              })();
            }}
            disabled={anyBusy}
            title={`Pull ${gitBehind} y push ${gitAhead}`}
            className="mt-1.5 w-full flex items-center justify-center gap-2 rounded bg-forge-accent/15 text-forge-accent text-[12px] py-1.5 hover:bg-forge-accent/25 disabled:opacity-40 disabled:hover:bg-forge-accent/15"
          >
            {gitSyncBusy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Sync Changes
            {gitBehind > 0 && (
              <span className="flex items-center">{gitBehind}<ArrowDown size={11} /></span>
            )}
            {gitAhead > 0 && (
              <span className="flex items-center">{gitAhead}<ArrowUp size={11} /></span>
            )}
          </button>
        )}
        {gitError && (
          <p className="mt-2 text-[11px] leading-snug text-red-400/90">{gitError}</p>
        )}
      </div>

      {githubModalOpen && <GithubAuthModal onClose={() => setGithubModalOpen(false)} />}

      <div className="flex-1 overflow-y-auto sidebar-scroll px-3 pb-4">
        {gitChanges.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-forge-text/40">
            <CheckCircle2 size={28} />
            <p className="text-[11px]">Working tree clean</p>
          </div>
        ) : (
          <>
            {unstaged.length > 0 && (
              <div className="mb-3">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
                  <span>Changes ({unstaged.length})</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (confirm(`¿Descartar los cambios de ${unstaged.length} archivo(s)? Esta acción no se puede deshacer.`)) {
                          void gitDiscardFiles(unstaged.map((c) => c.relPath));
                        }
                      }}
                      disabled={gitBusy}
                      title="Discard All Changes"
                      className="text-forge-text hover:text-red-400 disabled:opacity-30"
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      onClick={() => void gitStageFiles(unstaged.map((c) => c.relPath))}
                      disabled={gitBusy}
                      title="Stage All"
                      className="text-forge-text hover:text-forge-accent disabled:opacity-30"
                    >
                      <PlusCircle size={13} />
                    </button>
                  </div>
                </div>
                {unstaged.map((change) => renderChange(change, 'unstaged'))}
              </div>
            )}
            {staged.length > 0 && (
              <div>
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wide text-forge-text/50 mb-1.5">
                  <span>Staged ({staged.length})</span>
                  <button
                    onClick={() => void gitUnstageFiles(staged.map((c) => c.relPath))}
                    disabled={gitBusy}
                    title="Unstage All"
                    className="text-forge-text hover:text-forge-accent disabled:opacity-30"
                  >
                    <MinusCircle size={13} />
                  </button>
                </div>
                {staged.map((change) => renderChange(change, 'staged'))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}


function joinPath(parent: string, child: string): string {
  const sep = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return parent.endsWith(sep) ? `${parent}${child}` : `${parent}${sep}${child}`;
}
