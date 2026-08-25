# Cotação Eletroluz

Plataforma operacional do Departamento de Compras da Eletroluz — projeto interno **"Projeto Fênix / Cotação Eletroluz"**.

## 1. O que o sistema faz

Aplicação web de página única (SPA), sem framework — HTML, CSS e JavaScript puro — que organiza o fluxo de "oportunidades" (solicitações de itens fora do abastecimento normal) entre três perfis de usuário:

| Perfil | Tela principal | O que faz |
|---|---|---|
| **Loja** | Minhas Oportunidades | Abre novas oportunidades, acompanha o status das próprias solicitações, confirma venda / informa que não fechou / cancela / solicita revisão |
| **Operação** | Fila Operacional | Assume oportunidades da fila, cobra fornecedor, responde a loja, indefere, revisa cotação |
| **Gestor** | Dashboard do Gestor | Visão consolidada (KPIs, gráfico por status, SLA por faixa), acesso à mesma operação da Loja e da Operação, administração de usuários |

Outras telas: Nova Oportunidade, Detalhe da Oportunidade, Atendimento, Clientes, Follow-up de Estoque, Administração (gestão de usuários).

## 2. Arquitetura

- **Front-end:** `index.html` (estrutura + CSS embutido) e `script.js` (toda a lógica). Sem build step — os arquivos são servidos como estão.
- **Back-end:** [Supabase](https://supabase.com) — Auth (login por usuário/senha), Postgres com Row Level Security (RLS), e uma Edge Function para operações administrativas sensíveis.
- **Hospedagem do site:** [Netlify](https://netlify.com), com deploy automático a partir do repositório GitHub (`main` branch). *(O GitHub Pages foi testado primeiro, mas ficou bloqueado por política da organização no GitHub Enterprise; por isso a publicação foi movida para o Netlify.)*
- **Autenticação:** `supabaseClient.auth` (Supabase Auth). O `script.js` nunca guarda usuários ou senhas — só a *anon key* pública do Supabase, que por design não dá acesso a nada que a RLS não permita.
- **Tabelas do Postgres:** `profiles`, `oportunidades`, `historico`, `itens`, `fornecedores_cotados`, `arquivos_projeto` — criadas pelo `supabase-schema.sql`.
- **Edge Function:** `admin-users` — usada pela tela de Administração para operações sensíveis (criar usuário, resetar senha, ativar/inativar), validadas no servidor.

## 3. Estrutura de arquivos (deste pacote)

```
index.html               — estrutura da página, CSS, telas de login e do app
script.js                — lógica: autenticação, permissões, oportunidades, dashboard, administração
supabase-schema.sql       — schema do banco (tabelas + Row Level Security), rodar uma vez no SQL Editor do Supabase
supabase/functions/admin-users/index.ts — Edge Function para criar usuário / resetar senha com segurança
SETUP.md                 — passo a passo completo de configuração
README.md                — este arquivo
```

> `supabase-schema.sql` e o conteúdo de `supabase/` **não precisam ir para o site publicado** — servem só para configurar o projeto no Supabase.

## 4. Configuração — resumo

O `script.js` precisa das seguintes constantes preenchidas no topo do arquivo (ver `SETUP.md` para o passo a passo completo):

```js
const SUPABASE_URL = "https://SEU-PROJETO.supabase.co";
const SUPABASE_ANON_KEY = "sua-anon-key-publica";
const DOMINIO_LOGIN = "eletroluz.net"; // domínio usado para montar o e-mail interno do Auth (login@dominio)
```

A **anon key** é segura para ficar pública no GitHub — a proteção real vem das políticas de Row Level Security no banco. A **service_role key** do Supabase nunca deve aparecer em nenhum arquivo deste repositório; ela fica só como *secret* da Edge Function, configurada no painel do Supabase.

## 5. Publicação

O site está hospedado no **Netlify**, com deploy automático: qualquer alteração enviada (`commit`) para a branch `main` do repositório GitHub é publicada automaticamente em poucos segundos — não é necessário nenhum passo manual de "subir arquivo".

Para atualizar o sistema em produção:
1. Editar `index.html` e/ou `script.js` diretamente no GitHub (ou localmente e enviar por `git push`).
2. Aguardar o deploy automático do Netlify (ver aba **Deploys** do projeto no Netlify).
3. Testar em uma aba anônima do navegador para evitar cache antigo.

## 6. Login dos usuários

O login usa **usuário** (não e-mail completo) — o sistema monta o e-mail internamente como `usuario@DOMINIO_LOGIN` para autenticar no Supabase. Cadastro de novos usuários, hoje, é feito manualmente pelo painel do Supabase (Authentication → Users + inserção na tabela `profiles`), até a Edge Function `admin-users` ser publicada (Passo 6 do `SETUP.md`), o que habilita o cadastro direto pela tela de Administração do sistema.

## 7. Limitações conhecidas

Uma auditoria estática de código identificou pontos de melhoria registrados no histórico do projeto (permissões granulares que não bloqueiam ações, indicadores do Dashboard não calculados, etc.). Consulte o histórico de conversas/documentação interna do projeto para o detalhamento completo antes de tratá-los como bugs — vários desses pontos ainda precisam de validação com a operação real.

Além disso, como o `script.js` original não existia no início deste projeto, o fluxo de status das oportunidades (quando uma solicitação vira "Aguardando fornecedor", "Encaminhada para Compras", etc.) foi definido como **hipótese razoável**, com base nos textos e botões do `index.html` — vale validar com a operação real e ajustar se necessário (funções `setAcaoAtual` e `confirmarVendaReal` em `script.js`).

## 8. Changelog

### Publicação inicial
- Construção do `script.js` (login via Supabase Auth, CRUD de oportunidades, kanban da fila operacional, dashboards, administração de usuários).
- Criação do schema Supabase com Row Level Security por filial/perfil.
- Publicação testada primeiro no GitHub Pages — bloqueado pela política da organização (GitHub Enterprise) — publicação migrada para o Netlify com deploy automático via GitHub.
- Correção de um conflito de nomes entre a variável `supabase` (criada automaticamente pela biblioteca `supabase-js`) e a variável de mesmo nome declarada no `script.js`, causando erro de login (`Identifier 'supabase' has already been declared`). A variável do projeto foi renomeada para `supabaseClient`.
- Ajuste do domínio de login (`DOMINIO_LOGIN`) para refletir o e-mail real usado ao criar o primeiro usuário administrador no Supabase Auth.

---

*Documento gerado a partir da configuração real aplicada ao projeto, incluindo os ajustes feitos durante a publicação e depuração inicial.*
