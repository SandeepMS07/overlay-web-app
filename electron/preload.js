'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/**
 * The only bridge between the overlay UI and the main process. Nothing here
 * exposes raw ipcRenderer or Node APIs to the page.
 */
contextBridge.exposeInMainWorld('overlay', {
  getState: () => ipcRenderer.invoke('overlay:get-state'),

  setClickThrough: (enabled) => ipcRenderer.invoke('overlay:set-click-through', enabled),
  setInteractive: (interactive) => ipcRenderer.send('overlay:set-interactive', interactive),
  setAlwaysOnTop: (enabled) => ipcRenderer.invoke('overlay:set-always-on-top', enabled),
  setOpacity: (value) => ipcRenderer.invoke('overlay:set-opacity', value),
  setBounds: (bounds) => ipcRenderer.invoke('overlay:set-bounds', bounds),
  setSize: (size) => ipcRenderer.invoke('overlay:set-size', size),

  focusWindow: () => ipcRenderer.send('overlay:focus'),
  moveToActiveDisplay: () => ipcRenderer.send('overlay:move-to-active-display'),

  hide: () => ipcRenderer.send('overlay:hide'),
  quit: () => ipcRenderer.send('overlay:quit'),
  openExternal: (url) => ipcRenderer.send('overlay:open-external', url),

  /** Global shortcuts the main process forwards: 'opacity-up' | 'opacity-down' | 'focus-chat'. */
  onShortcut: (callback) => {
    const handler = (_event, action) => callback(action);
    ipcRenderer.on('overlay:shortcut', handler);
    return () => ipcRenderer.removeListener('overlay:shortcut', handler);
  },

  onClickThroughChanged: (callback) => {
    const handler = (_event, value) => callback(value);
    ipcRenderer.on('overlay:click-through-changed', handler);
    return () => ipcRenderer.removeListener('overlay:click-through-changed', handler);
  },
});
