// "Modo app": o sistema aberto de dentro do app DTCar do celular (APK), vindo da tela de botões em /app/ com ?app=1.
// Nesse modo o menu do computador e a barra de baixo somem, aparece "‹ Início" para voltar aos botões, e só o administrador
// altera O.S. que já existe (regra do Danilo, 16/11/2026). Fora do app (navegador, computador) nada muda.
// Só vale dentro do APK (window.Capacitor existe): um link com ?app=1 aberto num navegador comum não muda nada.
let modo = false;
const noApk = typeof window !== "undefined" && !!window.Capacitor;
try {
  if (noApk && /[?&]app=1(&|$)/.test(location.search)) sessionStorage.setItem("dtcar-modo-app", "1");
  modo = noApk && sessionStorage.getItem("dtcar-modo-app") === "1";
} catch (e) { modo = noApk && /[?&]app=1(&|$)/.test(location.search); }
if (modo && typeof document !== "undefined") {
  const marca = () => document.body && document.body.classList.add("modo-app");
  if (document.body) marca(); else document.addEventListener("DOMContentLoaded", marca);
}
export const modoApp = () => modo;
/** Perfil que a tela da O.S. usa: no app, quem não é administrador só consulta (papel "leitura", que só vê valores) */
export const perfilNoApp = p => modo && p && p.papel !== "admin" ? { ...p, papel: "leitura" } : p;
/** Volta para a tela de botões do app */
export const voltarAoApp = () => { location.href = "app/index.html"; };
