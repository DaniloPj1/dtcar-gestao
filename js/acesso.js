// Entrar sem internet: o computador também confere a senha.
// Quando a pessoa entra com internet (senha conferida pelo servidor), este aparelho guarda uma CONFERÊNCIA da senha
// (PBKDF2-SHA256 com sal aleatório; a senha em si nunca é guardada). Sem internet, a senha digitada é conferida aqui e o
// sistema abre com o banco do PC ("sessão do PC"). Quando a internet volta, é preciso entrar de novo com a senha para
// enviar o que foi feito sem internet (a sessão do PC não fala com o servidor).
import { local } from "./local.js";

const CHAVE = "acessos-pc", SESSAO = "dtcar-sessao-pc", VOLTAS = 150000;
const b64 = u8 => btoa(String.fromCharCode(...u8));
const deB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const norm = e => String(e || "").trim().toLowerCase();

async function derivar(senha, sal, voltas) {
  const chave = await crypto.subtle.importKey("raw", new TextEncoder().encode(senha), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: sal, iterations: voltas }, chave, 256));
}
const iguais = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/** depois de entrar com internet: guarda a conferência da senha deste usuário neste aparelho */
export async function guardarAcesso(email, senha, uid, nome) {
  if (!email || !senha || !uid || !(crypto && crypto.subtle)) return false;
  const sal = crypto.getRandomValues(new Uint8Array(16)), hash = await derivar(senha, sal, VOLTAS);
  const todos = (await local.ler(CHAVE)) || {};
  todos[norm(email)] = { uid, nome: nome || "", sal: b64(sal), hash: b64(hash), voltas: VOLTAS, em: new Date().toISOString() };
  return local.gravar(CHAVE, todos);
}
/** o acesso deste e-mail está guardado neste aparelho? */
export async function temAcessoGuardado(email) { const t = (await local.ler(CHAVE)) || {}; return email ? !!t[norm(email)] : Object.keys(t).length > 0; }
/** confere a senha sem internet; devolve { uid, email } ou null */
export async function conferirAcesso(email, senha) {
  const a = ((await local.ler(CHAVE)) || {})[norm(email)];
  if (!a || !senha) return null;
  return iguais(await derivar(senha, deB64(a.sal), a.voltas || VOLTAS), deB64(a.hash)) ? { uid: a.uid, email: norm(email) } : null;
}

/** sessão do PC (entrada sem internet): só identifica quem é; não serve para falar com o servidor */
export function entrarNoPC({ uid, email }) { try { localStorage.setItem(SESSAO, JSON.stringify({ user: { id: uid, email }, pc: true, em: new Date().toISOString() })); } catch (e) {} }
export function sessaoDoPC() { try { const s = JSON.parse(localStorage.getItem(SESSAO) || "null"); return s && s.user && s.user.id ? s : null; } catch (e) { return null; } }
export function sairDoPC() { try { localStorage.removeItem(SESSAO); } catch (e) {} }
