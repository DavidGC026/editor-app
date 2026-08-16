import { StateCreator } from 'zustand';

/** Actions the remote slice needs from the rest of the store. */
export interface RemoteDependencies {
  openFolder: (folderPath?: string) => Promise<void>;
}

export interface RemoteSlice {
  /** Whether the "Open Remote SSH" modal is visible. */
  remoteSSHModalOpen: boolean;
  setRemoteSSHModalOpen: (open: boolean) => void;
  /** Entry point used by the TitleBar menu and the Explorer panel. Electron
   *  does not implement window.prompt(), so the host/path inputs live in a
   *  dedicated modal (RemoteSSHModal) instead. */
  openRemoteWorkspace: () => Promise<void>;
  /** Connects to `target` over SSH and opens `path` as the workspace.
   *  Throws on connection failure so the modal can surface the error. */
  connectRemoteWorkspace: (target: string, path: string) => Promise<void>;
}

export const createRemoteSlice: StateCreator<
  RemoteSlice & RemoteDependencies,
  [],
  [],
  RemoteSlice
> = (set, get) => ({
  remoteSSHModalOpen: false,

  setRemoteSSHModalOpen: (open: boolean) => set({ remoteSSHModalOpen: open }),

  openRemoteWorkspace: async () => {
    set({ remoteSSHModalOpen: true });
  },

  connectRemoteWorkspace: async (target: string, path: string) => {
    const uri = await window.electronAPI.remote.connect({
      target: target.trim(),
      path: path.trim() || '~',
    });
    await get().openFolder(uri);
  },
});
