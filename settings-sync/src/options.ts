export type ToggleKey = 'autoUpload' | 'autoDownload' | 'forceUpload' | 'forceDownload' | 'quietSync';

export interface SyncAction {
  id: 'upload' | 'download' | ToggleKey | 'setToken' | 'chooseGist' | 'editLocal' | 'openSettings' | 'downloadPublic' | 'sharePublic' | 'addCustomFile' | 'importCustomFile' | 'how' | 'reset';
  label: string;
  icon: string;
  inOptions: boolean;
  toggle?: ToggleKey;
  on?: string;
  off?: string;
}

export const syncActions: SyncAction[] = [
  { id: 'upload', label: 'Upload', icon: 'cloud-upload', inOptions: false },
  { id: 'download', label: 'Download', icon: 'cloud-download', inOptions: false },
];

export const optionActions: SyncAction[] = [
  { id: 'setToken', label: 'Set GitHub Token', icon: 'key', inOptions: true },
  { id: 'chooseGist', label: 'Choose Gist', icon: 'github', inOptions: true },
  { id: 'editLocal', label: 'Edit Local Settings', icon: 'json', inOptions: true },
  { id: 'openSettings', label: 'Open Settings', icon: 'settings-gear', inOptions: true },
  { id: 'downloadPublic', label: 'Download Public Gist', icon: 'cloud-download', inOptions: true },
  { id: 'sharePublic', label: 'Upload to a New Public Gist', icon: 'globe', inOptions: true },
  { id: 'addCustomFile', label: 'Add Custom File', icon: 'new-file', inOptions: true },
  { id: 'importCustomFile', label: 'Import Custom File into Workspace', icon: 'folder-opened', inOptions: true },
  { id: 'autoUpload', label: 'Toggle Auto Upload', icon: 'sync', inOptions: true, toggle: 'autoUpload', on: 'Auto upload is on.', off: 'Auto upload is off.' },
  { id: 'autoDownload', label: 'Toggle Auto Download', icon: 'sync', inOptions: true, toggle: 'autoDownload', on: 'Auto download is on. It starts with the editor and does not change extensions.', off: 'Auto download is off.' },
  { id: 'forceUpload', label: 'Toggle Force Upload', icon: 'sync', inOptions: true, toggle: 'forceUpload', on: 'Force upload is on.', off: 'Force upload is off.' },
  { id: 'forceDownload', label: 'Toggle Force Download', icon: 'sync', inOptions: true, toggle: 'forceDownload', on: 'Force download is on.', off: 'Force download is off.' },
  { id: 'quietSync', label: 'Toggle Quiet Summary', icon: 'sync', inOptions: true, toggle: 'quietSync', on: 'Quiet summary is on.', off: 'Quiet summary is off.' },
  { id: 'how', label: 'How to Configure', icon: 'question', inOptions: false },
  { id: 'reset', label: 'Reset', icon: 'trash', inOptions: false },
];

export function optionsMenu(): SyncAction[] {
  return optionActions.filter((action) => action.inOptions);
}
