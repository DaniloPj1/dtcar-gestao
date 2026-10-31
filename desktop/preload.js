// Ponte entre as telas do sistema e o Windows: só o que o sistema precisa (pasta de dados e versão), nada além.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("dtcarDesktop", {
  programa: true,
  info: () => ipcRenderer.invoke("programa:info"),
  pasta: {
    info: () => ipcRenderer.invoke("pasta:info"),
    escrever: (rel, texto) => ipcRenderer.invoke("pasta:escrever", rel, texto),
    ler: rel => ipcRenderer.invoke("pasta:ler", rel),
    listar: rel => ipcRenderer.invoke("pasta:listar", rel),
    remover: rel => ipcRenderer.invoke("pasta:remover", rel),
    abrir: () => ipcRenderer.invoke("pasta:abrir"),
  },
});
// telas novas baixadas do site: mostra a faixa "Nova versão disponível" (a mesma do site)
ipcRenderer.on("dtcar-nova-versao", () => { window.__dtcarNovaVersao = true; window.dispatchEvent(new Event("dtcar-nova-versao")); });
