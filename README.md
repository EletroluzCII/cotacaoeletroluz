# cotacaoeletroluz
Cotação Eletroluz
Plataforma operacional do Departamento de Compras da Eletroluz — projeto interno "Projeto Fênix / Cotação Eletroluz".

Este README foi escrito a partir de leitura direta do código-fonte atual (index.html e script.js). Onde algo não pôde ser confirmado só lendo o código, está marcado como hipótese.

1. O que o sistema faz
Aplicação web de página única (SPA), sem framework — HTML, CSS e JavaScript puro — que organiza o fluxo de "oportunidades" (solicitações de itens fora do abastecimento normal) entre três perfis de usuário:

Perfil	Tela principal	O que faz
Loja	Minhas Oportunidades	Abre novas oportunidades, acompanha o status das suas solicitações, confirma venda / informa que não fechou / cancela / solicita revisão
Operação ("Lucas")	Fila Operacional	Assume oportunidades da fila, cobra fornecedor, responde a loja, indefere, revisa cotação
Gestor	Dashboard do Gestor	Visão consolidada (KPIs, gráfico por status, SLA por faixa), acesso à mesma operação da Loja e da Operação, administração de usuários
Outras telas: Nova Oportunidade, Detalhe da Oportunidade, Atendimento, Clientes, Follow-up de Estoque, Administração (gestão de usuários).

2. Arquitetura
Front-end: index.html (estrutura + CSS embutido) e script.js (toda a lógica). Sem build step — os arquivos são servidos como estão.
Back-end: Supabase — Auth (login por usuário/senha), Postgres com Row Level Security (RLS), Storage e uma Edge Function.
Autenticação: supabaseClient.auth (Supabase Auth). O script.js nunca guarda usuários ou senhas — só a anon key pública do Supabase, que por design não dá acesso a nada que a RLS não permita.
Tabelas do Postgres usadas pelo front-end: profiles, oportunidades, historico, compradores, itens, fornecedores_cotados, arquivos_projeto.
Storage: bucket privado arquivos-projeto, para anexos de Projeto Elétrico enviados pela loja.
Edge Function: admin-users — usada pela tela de Administração para operações sensíveis (criar usuário, resetar senha, ativar/inativar), validadas no servidor.
Esquema do banco: referenciado no código como supabase-schema.sql (não incluído neste pacote de arquivos).
3. Estrutura de arquivos (deste pacote)
index.html   — estrutura da página, CSS, telas de login e do app
script.js    — lógica: autenticação, permissões, oportunidades, dashboard, administração
README.md    — este arquivo
4. Publicação
Os arquivos são publicados como estão (sem build). Para atualizar o sistema em produção:

Substituir index.html e/ou script.js no local onde o site está hospedado.
Não é necessário nenhum arquivo de logotipo separado — o logotipo da Eletroluz já está embutido diretamente no index.html (ver Changelog).
5. Limitações conhecidas (auditoria de 11/08/2026)
Uma auditoria estática de código identificou os seguintes pontos, registrados no documento "Auditoria de Funcionamento - 2026-08-11" do projeto. Nenhuma dessas correções foi aplicada até o momento:

13 das 18 permissões granulares de usuário são cadastradas, mas nenhum botão do sistema verifica se estão marcadas antes de executar a ação (apenas 5 permissões realmente controlam algo na tela).
O botão "Solicitar revisão" (tela da Loja) não grava nada no banco — é só um aviso na tela.
Um card "Na Fila" no Kanban leva Gestor/Operação para a tela de ações da Loja, em vez da tela de atendimento.
Os indicadores "Tempo médio de resposta" e "SLA cumprido" do Dashboard Executivo nunca são calculados.
O perfil "Apoio" é criado sem nenhuma permissão e sem tela definida.
Um usuário de Loja com acesso à Fila Operacional pode "assumir" oportunidades, registrando o próprio nome como comprador.
O botão "Voltar" da tela de Administração sempre volta para o Dashboard do Gestor, mesmo que o usuário não tenha essa permissão (caso raro).
(Hipótese, não confirmada: pode existir uma camada adicional de proteção via RLS no Supabase que bloqueie no servidor algumas ações mesmo quando o botão aparece na tela.)

6. Changelog
2026-08-25 — Logotipo da Eletroluz
Adicionado o logotipo da Eletroluz no canto superior esquerdo do Dashboard do Gestor (dentro da <div class="brand"> do topbar), reaproveitando a classe el-logo já existente no CSS.
Correção: a primeira versão referenciava um arquivo externo (src="logo-eletroluz.png") com onerror="...display='none'" — se esse arquivo não existisse exatamente naquele caminho no servidor, o logotipo desaparecia silenciosamente, sem erro visível. Diagnosticado após o logotipo não aparecer em produção.
Solução aplicada: o logotipo foi embutido diretamente no index.html como imagem data URI (base64), tanto no topbar do painel quanto na tela de login — eliminando a dependência de qualquer arquivo de imagem externo.
script.js não foi alterado em nenhuma das etapas.
Documento gerado a partir da leitura do código-fonte e do histórico desta conversa. Fatos e hipóteses foram diferenciados conforme indicado no texto.
