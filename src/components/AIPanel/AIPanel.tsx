import { useEffect, useRef, useState } from 'react';
import { Plus, ChevronDown, Sparkles, Check, Settings2 } from 'lucide-react';
import { useStore } from '../../store';
import ApiKeyModal from './ApiKeyModal';
import ChatMessages from './ChatMessages';
import InputArea from './InputArea';
import DiffView from './DiffView';
import type { ProviderId, ProviderInfo } from '../../types';

/** Provider id → human-readable name lookup. Falls back to capitalising the id. */
function providerDisplayName(
  id: ProviderId,
  providers: ProviderInfo[] | null,
): string {
  const found = providers?.find((p) => p.id === id);
  if (found) return found.name;
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/** Top bar: shows the active provider/model on the left and the "+" key
 *  button on the right. Clicking the model name opens the picker dropdown,
 *  which lets the user switch between already-configured providers and
 *  pick a different model. */
function TopBar() {
  const activeProvider = useStore((s) => s.aiActiveProvider);
  const activeModel = useStore((s) => s.aiActiveModel);
  const availableModels = useStore((s) => s.aiAvailableModels);
  const configuredProviders = useStore((s) => s.aiConfiguredProviders);
  const setActive = useStore((s) => s.setAIActive);
  const setApiKeyModalOpen = useStore((s) => s.setAIApiKeyModalOpen);
  const refreshAIConfig = useStore((s) => s.refreshAIConfig);
  const setAvailableModels = useStore((s) => s.setAIAvailableModels);
  const menuOpen = useStore((s) => s.aiModelMenuOpen);
  const setMenuOpen = useStore((s) => s.setAIModelMenuOpen);

  const [providers, setProviders] = useState<ProviderInfo[] | null>(null);
  const [loadingList, setLoadingList] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Hydrate provider list + active config from the main process when this
  // component first mounts.
  useEffect(() => {
    window.electronAPI.ai
      .listProviders()
      .then((p) => setProviders(p as ProviderInfo[]))
      .catch(() => setProviders([]));
    void refreshAIConfig();
  }, [refreshAIConfig]);

  // Close the dropdown on outside click / Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onEsc);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onEsc);
    };
  }, [menuOpen, setMenuOpen]);

  /** Ensure the model list for `provider` is loaded into `availableModels`.
   *  Returns the resolved list (or [] on error). */
  const ensureModelsLoaded = async (provider: ProviderId): Promise<string[]> => {
    if (availableModels[provider] && availableModels[provider]!.length > 0) {
      return availableModels[provider]!;
    }
    setLoadingList(true);
    try {
      const models = await window.electronAPI.ai.listModels(provider);
      setAvailableModels(provider, models);
      return models;
    } catch (err) {
      console.warn('[forge] listModels failed for', provider, (err as Error)?.message);
      return [];
    } finally {
      setLoadingList(false);
    }
  };

  // When the dropdown opens, lazily fetch the active provider's model list.
  useEffect(() => {
    if (!menuOpen || !activeProvider) return;
    if (availableModels[activeProvider]) return;
    void ensureModelsLoaded(activeProvider);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, activeProvider]);

  const handleSelectModel = async (model: string) => {
    if (!activeProvider) return;
    console.debug('[forge:ai] TopBar select model →', activeProvider, model);
    await setActive(activeProvider, model);
    setMenuOpen(false);
  };

  /** Switch to another configured provider. Loads its model list and
   *  auto-selects the first model. */
  const handleSwitchProvider = async (provider: ProviderId) => {
    if (provider === activeProvider) return;
    console.debug('[forge:ai] TopBar switch provider →', provider);
    const models = await ensureModelsLoaded(provider);
    const first = models[0] || '';
    if (!first) {
      console.warn('[forge] no models for provider', provider);
      // Still set provider so the UI reflects the switch; user can pick a
      // model from the dropdown manually once it loads.
      await setActive(provider, '');
      return;
    }
    await setActive(provider, first);
  };

  const models = activeProvider ? availableModels[activeProvider] || [] : [];

  return (
    <div className="h-[40px] flex items-center justify-between px-3 border-b border-forge-border select-none flex-shrink-0">
      <div className="flex items-center gap-2 min-w-0 relative" ref={dropdownRef}>
        <Sparkles size={14} className="text-forge-accent flex-shrink-0" />
        {activeProvider && activeModel ? (
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-1.5 text-forge-text-strong text-[13px] hover:opacity-90 min-w-0"
            title="Cambiar proveedor o modelo"
          >
            <span className="flex-shrink-0">
              {providerDisplayName(activeProvider, providers)}
            </span>
            <span className="text-forge-text-dim">·</span>
            <span className="truncate">{activeModel}</span>
            <ChevronDown size={12} className="text-forge-text-dim flex-shrink-0" />
          </button>
        ) : (
          <span className="text-forge-text-dim text-[13px]">Agente (sin modelo)</span>
        )}

        {menuOpen && activeProvider && (
          <div
            className="dropdown-menu absolute top-9 left-0 z-50 min-w-[260px] max-h-[440px] overflow-y-auto sidebar-scroll"
          >
            {/* Section 1: switch between configured providers */}
            {configuredProviders.length > 1 && (
              <>
                <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-forge-text-dim border-b border-forge-border/60">
                  Proveedor activo
                </div>
                {configuredProviders.map((pid) => {
                  const isActive = pid === activeProvider;
                  return (
                    <button
                      key={pid}
                      onClick={() => handleSwitchProvider(pid)}
                      className={`flex items-center justify-between w-full text-left px-3 py-1.5 text-[12px] transition-colors
                        ${isActive
                          ? 'bg-forge-accent/15 text-forge-accent'
                          : 'text-forge-text-menu hover:bg-forge-accent/10 hover:text-forge-accent'}
                      `}
                    >
                      <span>{providerDisplayName(pid, providers)}</span>
                      {isActive && <Check size={12} className="flex-shrink-0" />}
                    </button>
                  );
                })}
              </>
            )}

            {/* Section 2: model picker for the active provider */}
            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-forge-text-dim border-b border-t border-forge-border/60">
              Modelos de {providerDisplayName(activeProvider, providers)}
            </div>
            {loadingList && (
              <div className="px-3 py-2 text-[12px] text-forge-text-dim">
                Cargando modelos…
              </div>
            )}
            {!loadingList && models.length === 0 && (
              <div className="px-3 py-2 text-[12px] text-forge-text-dim">
                Sin modelos disponibles.
              </div>
            )}
            {models.map((m) => (
              <button
                key={m}
                onClick={() => handleSelectModel(m)}
                className={`flex items-center justify-between w-full text-left px-3 py-1.5 text-[12px] transition-colors
                  ${m === activeModel
                    ? 'bg-forge-accent/15 text-forge-accent'
                    : 'text-forge-text-menu hover:bg-forge-accent/10 hover:text-forge-accent'}
                `}
              >
                <span className="truncate">{m}</span>
                {m === activeModel && <Check size={12} className="flex-shrink-0 ml-2" />}
              </button>
            ))}

            {/* Section 3: footer → open the API-key manager */}
            <div className="border-t border-forge-border/60">
              <button
                onClick={() => {
                  setMenuOpen(false);
                  setApiKeyModalOpen(true);
                }}
                className="flex items-center gap-2 w-full text-left px-3 py-2 text-[12px] text-forge-text-menu hover:bg-forge-accent/10 hover:text-forge-accent transition-colors"
              >
                <Settings2 size={13} />
                Gestionar claves de API…
              </button>
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => setApiKeyModalOpen(true)}
        title="Añadir / cambiar clave de API"
        className="h-7 w-7 rounded flex items-center justify-center text-forge-text hover:text-forge-text-strong hover:bg-white/5"
      >
        <Plus size={16} />
      </button>
    </div>
  );
}

/** Empty / "no provider configured" state shown center-panel. */
function EmptyState() {
  const setApiKeyModalOpen = useStore((s) => s.setAIApiKeyModalOpen);
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-4">
      <Sparkles size={36} className="text-forge-accent" />
      <h2 className="text-2xl font-light text-forge-text-strong tracking-wide">
        Agente
      </h2>
      <p className="text-[12px] text-forge-text-dim leading-relaxed max-w-[260px]">
        Ingresa una clave de API antes de usar el agente. Tu clave se guarda
        solo en este equipo.
      </p>
      <button
        onClick={() => setApiKeyModalOpen(true)}
        className="px-4 py-2 rounded bg-forge-accent text-black text-[13px] font-medium hover:opacity-90"
      >
        Configurar clave de API
      </button>
    </div>
  );
}

/** Banner shown when /init has not been run yet for the current workspace. */
function NoInitBanner() {
  return (
    <div className="px-3 py-2 text-[12px] text-forge-accent border-b border-forge-border bg-forge-accent/5">
      Este proyecto aún no ha sido inicializado por el agente. Ejecuta el
      comando <code className="px-1 py-0.5 rounded bg-forge-input">/init</code> para generar PROJECT.md.
    </div>
  );
}

export default function AIPanel() {
  const activeProvider = useStore((s) => s.aiActiveProvider);
  const activeModel = useStore((s) => s.aiActiveModel);
  const workspacePath = useStore((s) => s.workspacePath);
  const initDone = useStore((s) => s.aiInitDone);
  const messages = useStore((s) => s.aiMessages);
  const refreshAIConfig = useStore((s) => s.refreshAIConfig);

  // Hydrate config on mount.
  useEffect(() => {
    void refreshAIConfig();
  }, [refreshAIConfig]);

  const providerReady = !!(activeProvider && activeModel);

  return (
    <div className="h-full w-full flex flex-col bg-forge-sidebar text-forge-text">
      <TopBar />
      {!providerReady ? (
        <EmptyState />
      ) : (
        <>
          {workspacePath && !initDone && messages.length === 0 && <NoInitBanner />}
          <ChatMessages />
        </>
      )}
      <InputArea />
      <ApiKeyModal />
      <DiffView />
    </div>
  );
}
