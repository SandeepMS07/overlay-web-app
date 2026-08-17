export type OverlayState = {
  clickThrough: boolean;
  alwaysOnTop: boolean;
  bounds: { x: number; y: number; width: number; height: number } | null;
  platform: NodeJS.Platform;
};

export type ShortcutAction = 'opacity-up' | 'opacity-down' | 'focus-chat';

export type OverlayBridge = {
  getState(): Promise<OverlayState>;
  setClickThrough(enabled: boolean): Promise<boolean>;
  setInteractive(interactive: boolean): void;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  setOpacity(value: number): Promise<number>;
  setBounds(bounds: Partial<{ x: number; y: number; width: number; height: number }>): Promise<unknown>;
  setSize(size: { width: number; height: number }): Promise<unknown>;
  focusWindow(): void;
  moveToActiveDisplay(): void;
  hide(): void;
  quit(): void;
  openExternal(url: string): void;
  onShortcut(callback: (action: ShortcutAction) => void): () => void;
  onClickThroughChanged(callback: (value: boolean) => void): () => void;
};

declare global {
  interface Window {
    /** Injected by electron/preload.js. Undefined when the UI runs in a plain browser. */
    overlay?: OverlayBridge;
  }
}

export {};
