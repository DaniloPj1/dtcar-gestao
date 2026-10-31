// Ponte entre as telas do sistema e o Windows: só o que o sistema precisa (pasta de dados e versão), nada além.
const { contextBridge, ipcRenderer } = require("electron");
let novaVersao = false; // o preload roda em outro "mundo": variável no window daqui não aparece para as telas
contextBridge.exposeInMainWorld("dtcarDesktop", {
  programa: true,
  novaVersao: () => novaVersao,
  info: () => ipcRenderer.invoke("programa:info"),
  banco: {
    info: () => ipcRenderer.invoke("banco:info"),
    substituir: (tabela, texto) => ipcRenderer.invoke("banco:substituir", tabela, texto),
    preparar: (tabela, texto) => ipcRenderer.invoke("banco:preparar", tabela, texto),
    promover: tabelas => ipcRenderer.invoke("banco:promover", tabelas),
    descartarPreparo: () => ipcRenderer.invoke("banco:descartarPreparo"),
    mesclar: (tabela, texto) => ipcRenderer.invoke("banco:mesclar", tabela, texto),
    remover: (tabela, ids) => ipcRenderer.invoke("banco:remover", tabela, ids),
    manterSo: (tabela, ids) => ipcRenderer.invoke("banco:manterSo", tabela, ids),
    listar: tabela => ipcRenderer.invoke("banco:listar", tabela),
    porOrdem: (tabela, ordemId) => ipcRenderer.invoke("banco:porOrdem", tabela, ordemId),
    um: (tabela, id) => ipcRenderer.invoke("banco:um", tabela, id),
    maiorData: tabela => ipcRenderer.invoke("banco:maiorData", tabela),
    meta: (k, v) => ipcRenderer.invoke("banco:meta", k, v),
    zerar: () => ipcRenderer.invoke("banco:zerar"),
    copiaDoDia: () => ipcRenderer.invoke("banco:copiaDoDia"),
  },
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
ipcRenderer.on("dtcar-nova-versao", () => { novaVersao = true; window.dispatchEvent(new Event("dtcar-nova-versao")); });
