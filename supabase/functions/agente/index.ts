// DTCar Gestão — conector "agente" (servidor MCP do Claude), Fase 1 do agente de IA.
//
// O Danilo adiciona este endereço como conector personalizado no app do Claude:
//   https://<projeto>.supabase.co/functions/v1/agente
// O Claude descobre sozinho o login (OAuth 2.1 do Supabase Auth), o Danilo entra com o
// usuário dele no DTCar Gestão e autoriza na tela /consentimento.html do site.
// Cada pedido chega com o token desse usuário: as regras de acesso do banco valem e as
// funções do agente (supabase/v20.sql) exigem administrador. Nenhuma chave secreta é usada.
//
// Publicar com "Verify JWT" DESLIGADO (o próprio código confere o token; o Claude precisa
// receber o 401 com o endereço do login antes de ter token).
import { pipeline } from "npm:@supabase/middleware@1.0.0";
import { withOAuthProtectedResource, withSupabase } from "npm:@supabase/server@1.9.2";
import { createMcpHandler } from "npm:@modelcontextprotocol/server@2.4.0";
import { criarServidor } from "./ferramentas.ts";

export const atender = pipeline(
  [withOAuthProtectedResource(), withSupabase({ auth: "user" })],
  async (req, { supabase }) => {
    const handler = createMcpHandler(() => criarServidor(supabase), {
      onerror: (e: unknown) => console.error("Falha no conector do agente", e),
    });
    return handler.fetch(req);
  },
);

if (import.meta.main) Deno.serve((req) => atender(req));
