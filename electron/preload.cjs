// Preload script: exposes a tiny, read-only surface to the renderer over a
// context-isolated bridge. The UI is a normal Next.js web app, so it needs
// almost nothing from Electron — just enough to show version info and to know
// it is running inside the desktop shell.
const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  },
});
