import { useEffect, useRef, useState } from 'react';
import { KeyRound, Loader2, Check, Trash2 } from 'lucide-react';
import { useStore } from '../../store';
import Modal from '../ui/Modal';
import type { ProviderId, ProviderInfo } from '../../types';

/**
 * Modal for configuring / changing API keys. The flow:
 *   1. User picks a provider from a list.
 *   2. User types the API key.
 *   3. We persist the key (main process) and immediately query the provider
 *      for the list of available models.
 *   4. User picks a model. We set it as the active provider/model and close
 *      the modal.
 */
export default function ApiKeyModal() {
  const open = useStore((s) => s.aiApiKeyModalOpen);
  const setOpen = useStore((s) => s.setAIApiKeyModalOpen);
  const configuredProviders = useStore((s) => s.aiConfiguredProviders);
  const availableModels = useStore((s) => s.aiAvailableModels);
  const setAvailableModels = useStore((s) => s.setAIAvailableModels);
  const refreshAIConfig = useStore((s) => s.refreshAIConfig);
  const setActive = useStore((s) => s.setAIActive);
  const removeProvider = useStore((s) => s.removeAIProvider);
  const activeProvider = useStore((s) => s.aiActiveProvider);

  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<ProviderId | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [loadingModels, setLoadingModels] = useState(false);
  /** Provider currently shown in the "are you sure?" confirm-delete UI. */
  const [confirmDelete, setConfirmDelete] = useState<ProviderId | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Load the static providers list once.
  useEffect(() => {
    if (!open) return;
    window.electronAPI.ai
      .listProviders()
      .then((ps) => setProviders(ps as ProviderInfo[]))
      .catch(() => setProviders([]));
  }, [open]);

  // Reset state every time the modal opens.
  useEffect(() => {
    if (open) {
      setSelectedProvider(activeProvider || null);
      setApiKey('');
      setError(null);
      setModels([]);
      setSelectedModel('');
      setLoadingModels(false);
      setSaving(false);
      setConfirmDelete(null);
      // Focus the API key input shortly after the modal renders.
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, activeProvider]);

  /** Removes the API key for the given provider after user confirmation. */
  const handleDeleteProvider = async (provider: ProviderId) => {
    try {
      await removeProvider(provider);
      await refreshAIConfig();
      setConfirmDelete(null);
      // If the user just removed the provider they had selected in the
      // top-right "Add key" flow, reset that selection too.
      if (selectedProvider === provider) {
        setSelectedProvider(null);
        setModels([]);
        setSelectedModel('');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  // If the currently-selected provider already has a known model list (e.g.
  // returned from a previous /listModels call earlier in the session) show
  // it. If the provider is already configured but we don't have a cached
  // model list, fetch it automatically so the user can pick a different
  // model without re-entering the key.
  useEffect(() => {
    if (!selectedProvider) {
      setModels([]);
      setSelectedModel('');
      return;
    }
    const cached = availableModels[selectedProvider];
    if (cached && cached.length > 0) {
      setModels(cached);
      // Pre-select something sensible: the active model if the user is editing
      // the currently-active provider, otherwise the first model in the list.
      setSelectedModel((cur) => {
        if (cur) return cur;
        // For currently-active provider, prefer the active model.
        const activeModel = useStore.getState().aiActiveModel;
        if (activeProvider === selectedProvider && activeModel && cached.includes(activeModel)) {
          return activeModel;
        }
        return cached[0];
      });
      return;
    }
    if (configuredProviders.includes(selectedProvider)) {
      // Auto-fetch models for already-configured providers.
      setLoadingModels(true);
      window.electronAPI.ai
        .listModels(selectedProvider)
        .then((m) => {
          setAvailableModels(selectedProvider, m);
          setModels(m);
          if (m.length > 0) setSelectedModel(m[0]);
        })
        .catch((err) => setError((err as Error).message))
        .finally(() => setLoadingModels(false));
    } else {
      setModels([]);
      setSelectedModel('');
    }
  }, [selectedProvider, availableModels, configuredProviders, activeProvider, setAvailableModels]);

  if (!open) return null;

  const handleSaveKey = async () => {
    if (!selectedProvider || !apiKey.trim()) {
      setError('Selecciona un proveedor e ingresa una clave de API.');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await window.electronAPI.ai.setApiKey(selectedProvider, apiKey.trim());
      await refreshAIConfig();
      setLoadingModels(true);
      const m = await window.electronAPI.ai.listModels(selectedProvider);
      setAvailableModels(selectedProvider, m);
      setModels(m);
      // Pre-select the first model so the user only has to click "Activar".
      if (m.length > 0) setSelectedModel(m[0]);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoadingModels(false);
      setSaving(false);
    }
  };

  const handleActivate = async () => {
    if (!selectedProvider || !selectedModel) {
      setError('Selecciona un modelo.');
      return;
    }
    await setActive(selectedProvider, selectedModel);
    setOpen(false);
  };

  const close = () => setOpen(false);

  return (
    <Modal
      title={
        configuredProviders.length > 0
          ? 'Gestionar proveedores de IA'
          : 'Configurar proveedor de IA'
      }
      icon={<KeyRound size={16} className="text-forge-accent" />}
      onClose={close}
      footer={
        <>
          <button
            onClick={close}
            className="px-3 py-1.5 text-[12px] text-forge-text hover:text-forge-text-strong"
          >
            Cancelar
          </button>
          <button
            onClick={handleActivate}
            disabled={!selectedProvider || !selectedModel}
            className={`px-3 py-1.5 rounded text-[12px] font-medium transition-colors
              ${!selectedProvider || !selectedModel
                ? 'bg-forge-input/60 text-forge-text-dim cursor-not-allowed'
                : 'bg-forge-accent text-black hover:opacity-90'}
            `}
          >
            Activar
          </button>
        </>
      }
    >
      {/* Configured providers — switch or delete already-saved keys */}
          {configuredProviders.length > 0 && (
            <div>
              <label className="block text-xs text-forge-text-dim mb-2">
                Proveedores configurados
              </label>
              <div className="border border-forge-border rounded divide-y divide-forge-border/60 overflow-hidden">
                {configuredProviders.map((pid) => {
                  const info = providers.find((p) => p.id === pid);
                  const name = info?.name || pid;
                  const isActive = pid === activeProvider;
                  const isConfirming = confirmDelete === pid;
                  return (
                    <div
                      key={pid}
                      className="flex items-center justify-between px-3 py-2 bg-forge-input/30"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Check size={12} className="text-forge-accent flex-shrink-0" />
                        <span className="text-[13px] text-forge-text-strong truncate">
                          {name}
                        </span>
                        {isActive && (
                          <span className="text-[10px] uppercase tracking-wide text-forge-accent border border-forge-accent/40 rounded px-1.5 py-0.5 flex-shrink-0">
                            Activo
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {!isActive && (
                          <button
                            onClick={() => setSelectedProvider(pid)}
                            className="text-[11px] text-forge-text-dim hover:text-forge-accent"
                            title={`Usar ${name} en el formulario inferior`}
                          >
                            Seleccionar
                          </button>
                        )}
                        {isConfirming ? (
                          <div className="flex items-center gap-1">
                            <span className="text-[11px] text-red-400">
                              ¿Eliminar?
                            </span>
                            <button
                              onClick={() => handleDeleteProvider(pid)}
                              className="text-[11px] px-2 py-0.5 rounded bg-red-500/20 text-red-300 border border-red-500/40 hover:bg-red-500/30"
                            >
                              Sí
                            </button>
                            <button
                              onClick={() => setConfirmDelete(null)}
                              className="text-[11px] px-2 py-0.5 rounded text-forge-text-dim hover:text-forge-text-strong"
                            >
                              No
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => setConfirmDelete(pid)}
                            title={`Eliminar la clave de ${name}`}
                            className="h-6 w-6 rounded flex items-center justify-center text-forge-text-dim hover:text-red-400 hover:bg-red-500/10"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[11px] text-forge-text-dim leading-relaxed">
                Al eliminar una clave se borra del almacenamiento local. Si era
                la del proveedor activo, deberás seleccionar otro para seguir
                usando el agente.
              </p>
            </div>
          )}

          {/* Provider grid */}
          <div>
            <label className="block text-xs text-forge-text-dim mb-2">
              {configuredProviders.length > 0
                ? 'Añadir / actualizar clave'
                : 'Proveedor'}
            </label>
            <div className="grid grid-cols-2 gap-2">
              {providers.map((p) => {
                const isConfigured = configuredProviders.includes(p.id);
                const isSelected = selectedProvider === p.id;
                return (
                  <button
                    key={p.id}
                    onClick={() => setSelectedProvider(p.id)}
                    className={`relative text-left px-3 py-2 rounded border transition-colors
                      ${isSelected
                        ? 'border-forge-accent bg-forge-accent/10 text-forge-text-strong'
                        : 'border-forge-border bg-forge-input/40 text-forge-text hover:bg-forge-input'}
                    `}
                  >
                    <div className="text-[13px] font-medium flex items-center gap-1.5">
                      {p.name}
                      {isConfigured && (
                        <Check size={12} className="text-forge-accent" />
                      )}
                    </div>
                    {p.hint && (
                      <div className="text-[11px] text-forge-text-dim mt-0.5">
                        {p.hint}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* API key input */}
          <div>
            <label className="block text-xs text-forge-text-dim mb-1">
              Clave de API
            </label>
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="password"
                placeholder="sk-... / AIza... / etc."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !saving) handleSaveKey();
                }}
                className="forge-input flex-1"
              />
              <button
                onClick={handleSaveKey}
                disabled={saving || !selectedProvider || !apiKey.trim()}
                className={`px-3 rounded text-[13px] font-medium transition-colors
                  ${saving || !selectedProvider || !apiKey.trim()
                    ? 'bg-forge-input/60 text-forge-text-dim cursor-not-allowed'
                    : 'bg-forge-accent text-black hover:opacity-90'}
                `}
              >
                {saving ? 'Guardando…' : 'Guardar y listar modelos'}
              </button>
            </div>
            <p className="mt-2 text-[11px] text-forge-text-dim leading-relaxed">
              Tu clave se guarda solo en este equipo (electron-store local) y
              nunca se envía a ningún servidor de Forge.
            </p>
          </div>

          {/* Error */}
          {error && (
            <div className="text-[12px] text-red-400 bg-red-500/10 border border-red-500/30 rounded px-3 py-2 whitespace-pre-wrap">
              {error}
            </div>
          )}

          {/* Model selection */}
          {(loadingModels || models.length > 0) && (
            <div>
              <label className="block text-xs text-forge-text-dim mb-1">
                Modelo
              </label>
              {loadingModels ? (
                <div className="flex items-center gap-2 text-forge-text-dim text-[12px]">
                  <Loader2 size={14} className="animate-spin" />
                  Obteniendo modelos disponibles…
                </div>
              ) : (
                <select
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  className="forge-input w-full"
                >
                  {models.map((m) => (
                    <option key={m} value={m} className="bg-forge-sidebar">
                      {m}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}
    </Modal>
  );
}
