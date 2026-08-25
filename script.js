/* =====================================================================
   PROJETO FÊNIX / COTAÇÃO ELETROLUZ — script.js
   -----------------------------------------------------------------------
   Este arquivo NUNCA guarda usuários ou senhas. Toda autenticação é feita
   pelo Supabase Auth (auth.users), e os dados operacionais ficam em
   tabelas do Supabase protegidas por Row Level Security (RLS) — veja
   supabase-schema.sql. A única credencial que existe aqui é a "anon key"
   do Supabase, que é pública por design e não dá acesso a nada que a
   RLS não permita. Nunca coloque a "service_role key" neste arquivo.
   ===================================================================== */

// ---------------------------------------------------------------------
// 0) CONFIGURAÇÃO DO SUPABASE — preencha com os dados do seu projeto
// (Supabase > Project Settings > API)
// ---------------------------------------------------------------------
const SUPABASE_URL = "https://bhqqmzhdfvqwtvhazwxf.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJocXFtemhkZnZxd3R2aGF6d3hmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwMzI5NjAsImV4cCI6MjEwMTYwODk2MH0.vH5JftbRH4DJYXHzf3ksKPQ7fYXthsiawrPMky7-FYI";
const DOMINIO_LOGIN = "eletroluz.net"; // usado só para montar o e-mail interno do Auth (login@eletroluz.local)

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Bucket do Supabase Storage onde ficam os arquivos de Projeto Elétrico
// anexados pela loja (plantas, memoriais, especificações). Precisa existir
// no painel do Supabase (Storage > New bucket), como bucket privado.
const BUCKET_ARQUIVOS_PROJETO = 'arquivos-projeto';

// ---------------------------------------------------------------------
// 0.1) RECUPERAÇÃO DE SENHA ("Esqueci minha senha")
// -----------------------------------------------------------------------
// Quando o usuário clica no link recebido por e-mail, o Supabase Auth
// abre esta mesma página com um token de recuperação e dispara o evento
// 'PASSWORD_RECOVERY'. Esse registro precisa existir ANTES de qualquer
// outra coisa rodar, para não deixar a tela carregar o app normalmente
// enquanto o usuário ainda precisa definir a nova senha.
// ---------------------------------------------------------------------
let recuperandoSenha = false;
supabaseClient.auth.onAuthStateChange((event)=>{
  if(event === 'PASSWORD_RECOVERY'){
    recuperandoSenha = true;
    const modal = document.getElementById('recoveryModal');
    if(modal) modal.classList.remove('hidden');
  }
});

// ---------------------------------------------------------------------
// 1) ESTADO GLOBAL (em memória, recarregado do Supabase a cada ação)
// ---------------------------------------------------------------------
let currentUser = null;        // { id, login, nome, perfil, filial_padrao, permissoes, ativo }
let oportunidades = [];        // cache local da última consulta ao Supabase
let profilesCache = [];        // cache de usuários (tela de administração)
let currentScreen = null;
let currentOpportunityId = null;
let itensDraft = [];           // itens sendo montados na tela "Nova oportunidade"
let projetoArquivosDraft = []; // arquivos de projeto elétrico sendo anexados
let lucasFilterAtual = 'todos';
let adminPerfilFilterAtual = 'todos';
let adminStatusFilterAtual = 'todos';
let adminUsuarioSelecionadoId = null; // usado pelos modais de reset/rename/permissões
let compradoresCache = []; // lista de nomes de "Comprador responsável", gerenciada só por Gestor/Administração

const FILIAIS = [
  "Matriz - Maringá","Sarandi","Cianorte","Campo Mourão","Umuarama","Apucarana",
  "Centro de Distribuição - CD","Exceleds","Foco - CD","Londrina","Maringá 02",
  "Ponta Grossa","Presidente Prudente","Central"
];

const PERFIL_LABEL = { loja: 'Loja', lucas: 'Operação', gestor: 'Gestor', apoio: 'Apoio' };

function permissoesPadrao(perfil){
  const base = {
    perm_abrir:false, perm_consultar_proprias:false, perm_confirmar_venda:false,
    perm_solicitar_revisao:false, perm_cancelar:false, perm_nao_fechou:false,
    perm_fila:false, perm_assumir:false, perm_cotar:false, perm_responder:false,
    perm_indeferir:false, perm_excluir:false,
    perm_dashboard:false, perm_usuarios:false, perm_resetar:false, perm_inativar:false,
    perm_sla:false, perm_todas_filiais:false
  };
  if(perfil==='loja'){
    Object.assign(base,{perm_abrir:true,perm_consultar_proprias:true,perm_confirmar_venda:true,perm_solicitar_revisao:true,perm_cancelar:true,perm_nao_fechou:true});
  } else if(perfil==='lucas'){
    Object.assign(base,{perm_fila:true,perm_assumir:true,perm_cotar:true,perm_responder:true,perm_indeferir:true,perm_dashboard:true});
  } else if(perfil==='gestor'){
    Object.keys(base).forEach(k=>base[k]=true);
  }
  return base;
}

// ---------------------------------------------------------------------
// 2) AUTENTICAÇÃO
// ---------------------------------------------------------------------
async function doLogin(){
  const loginDigitado = (document.getElementById('loginUser').value||'').trim();
  const senha = document.getElementById('loginPass').value||'';
  if(!loginDigitado || !senha){ alert('Informe usuário e senha.'); return; }

  const email = loginDigitado.includes('@') ? loginDigitado : `${loginDigitado.toLowerCase()}@${DOMINIO_LOGIN}`;

  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
  if(error){
    alert('Usuário ou senha inválidos.');
    return;
  }
  await carregarSessaoAtual();
}

// --- Esqueci minha senha ---
function openForgotModal(){
  document.getElementById('forgotUser').value = '';
  document.getElementById('forgotModal').classList.remove('hidden');
}
function closeForgotModal(){ document.getElementById('forgotModal').classList.add('hidden'); }

async function sendForgotPassword(){
  const loginDigitado = (document.getElementById('forgotUser').value||'').trim();
  if(!loginDigitado){ alert('Informe seu usuário.'); return; }
  const email = loginDigitado.includes('@') ? loginDigitado : `${loginDigitado.toLowerCase()}@${DOMINIO_LOGIN}`;

  await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });
  // Por segurança, não informamos se o usuário existe ou não — a mensagem é sempre a mesma.
  closeForgotModal();
  alert('Se o usuário existir, enviamos um e-mail com o link para criar uma nova senha.');
}

async function saveRecoveryPassword(){
  const nova = document.getElementById('recoveryNova').value;
  const conf = document.getElementById('recoveryConf').value;
  if(!nova || !conf){ alert('Preencha os dois campos.'); return; }
  if(nova !== conf){ alert('As senhas não coincidem.'); return; }
  if(nova.length < 8){ alert('A nova senha deve ter pelo menos 8 caracteres.'); return; }

  const { error } = await supabaseClient.auth.updateUser({ password: nova });
  if(error){ alert('Erro ao salvar nova senha: '+error.message); return; }

  document.getElementById('recoveryModal').classList.add('hidden');
  recuperandoSenha = false;
  alert('Senha alterada com sucesso! Você já está conectado.');
  await carregarSessaoAtual();
}

async function cancelRecoveryPassword(){
  await supabaseClient.auth.signOut();
  recuperandoSenha = false;
  document.getElementById('recoveryModal').classList.add('hidden');
  mostrarTelaLogin();
}

async function carregarSessaoAtual(){
  if(recuperandoSenha) return; // aguarda o usuário definir a nova senha antes de carregar o app
  const { data: sessionData } = await supabaseClient.auth.getSession();
  if(!sessionData || !sessionData.session){ mostrarTelaLogin(); return; }

  const userId = sessionData.session.user.id;
  const { data: perfil, error } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
  if(error || !perfil){
    alert('Não encontramos seu perfil de acesso. Fale com o administrador do sistema.');
    await supabaseClient.auth.signOut();
    mostrarTelaLogin();
    return;
  }
  if(!perfil.ativo){
    alert('Seu usuário está inativo. Fale com o administrador.');
    await supabaseClient.auth.signOut();
    mostrarTelaLogin();
    return;
  }

  currentUser = perfil;
  document.getElementById('login').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('branchName').textContent = currentUser.filial_padrao || '';
  document.getElementById('topbarUserName').textContent = currentUser.nome || '';
  document.getElementById('opsTopBtn').classList.toggle('hidden', !(currentUser.permissoes.perm_fila || currentUser.perfil==='loja'));
  document.getElementById('adminTopBtn').classList.toggle('hidden', !(currentUser.permissoes.perm_usuarios));

  await carregarOportunidades();
  await carregarCompradores();

  if(currentUser.perfil === 'loja') show('loja');
  else if(currentUser.permissoes.perm_dashboard) show('gestor');
  else if(currentUser.permissoes.perm_fila) show('lucas');
  else show('loja');
}

function mostrarTelaLogin(){
  currentUser = null;
  document.getElementById('app').classList.add('hidden');
  document.getElementById('login').classList.remove('hidden');
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('topbarUserName').textContent = '';
}

async function logout(){
  await supabaseClient.auth.signOut();
  mostrarTelaLogin();
}

// ---------------------------------------------------------------------
// 3) NAVEGAÇÃO ENTRE TELAS
// ---------------------------------------------------------------------
async function show(nome){
  document.querySelectorAll('main[id^="screen-"]').forEach(m=>m.classList.add('hidden'));
  const alvo = document.getElementById('screen-'+nome);
  if(alvo) alvo.classList.remove('hidden');
  currentScreen = nome;

  if(nome==='loja') renderLoja();
  if(nome==='nova') prepararNovaOportunidade();
  if(nome==='lucas') renderLucas();
  if(nome==='gestor') atualizarDashboardGestor();
  if(nome==='admin'){ renderAdminUsers(); renderCompradoresAdmin(); }
  if(nome==='estoque') renderEstoque();
  if(nome==='clientes') renderClientes();
}

// Carrega o app quando a página abre (mantém sessão ativa entre recarregamentos)
window.addEventListener('DOMContentLoaded', async ()=>{
  if(!window.supabase){
    alert('Não foi possível carregar a biblioteca do Supabase. Verifique sua conexão com a internet.');
    return;
  }

  // Permite entrar apertando Enter no campo de usuário ou de senha,
  // sem precisar clicar no botão ENTRAR com o mouse.
  const campoLoginUser = document.getElementById('loginUser');
  const campoLoginPass = document.getElementById('loginPass');
  if(campoLoginUser) campoLoginUser.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); doLogin(); } });
  if(campoLoginPass) campoLoginPass.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); doLogin(); } });

  await carregarSessaoAtual();
});

// ---------------------------------------------------------------------
// 4) CARREGAMENTO DE DADOS (Supabase)
// ---------------------------------------------------------------------
// Lista de nomes disponíveis para "Comprador responsável". Fica guardada na
// tabela compradores (id, nome) do Supabase — incluir/remover nomes aqui é
// feito só pela tela de Administração (Gestor/Administração).
async function carregarCompradores(){
  const { data, error } = await supabaseClient.from('compradores').select('*').order('nome');
  if(error){ console.error(error); return; }
  compradoresCache = data || [];
}

async function carregarOportunidades(){
  const { data, error } = await supabaseClient
    .from('oportunidades')
    .select(`*, itens(*), fornecedores_cotados(*), historico(*), arquivos_projeto(*)`)
    .order('criado_em', { ascending: false });
  if(error){ console.error(error); alert('Erro ao carregar oportunidades: '+error.message); oportunidades = []; return; }
  oportunidades = data || [];
}

async function registrarHistorico(oportunidadeId, acao, detalhe){
  await supabaseClient.from('historico').insert({
    oportunidade_id: oportunidadeId,
    autor: currentUser ? currentUser.nome : 'Sistema',
    acao, detalhe: detalhe||null
  });
}

async function atualizarOportunidade(id, campos){
  const { error } = await supabaseClient.from('oportunidades').update(campos).eq('id', id);
  if(error){ alert('Erro ao salvar: '+error.message); return false; }
  await carregarOportunidades();
  return true;
}

function buscarOportunidade(id){
  return oportunidades.find(o=>o.id===id) || null;
}

// ---------------------------------------------------------------------
// 5) CONSULTAS USADAS PELOS PAINÉIS (dashboards e KPIs)
// ---------------------------------------------------------------------
function visibleOpps(){
  if(!currentUser) return [];
  if(currentUser.permissoes.perm_todas_filiais || currentUser.permissoes.perm_fila || currentUser.perfil==='gestor'){
    return oportunidades;
  }
  return oportunidades.filter(o=>o.filial === currentUser.filial_padrao);
}
function getByStatus(status){ return visibleOpps().filter(o=>o.status===status); }
function getByAction(acao){ return visibleOpps().filter(o=>o.proxima_acao===acao); }
function getEmAtendimento(){ return visibleOpps().filter(o=>['Em atendimento','Aguardando fornecedor','Em revisão'].includes(o.status)); }

// Regras de SLA: 08:00–13:00 e 14:12–18:00, horas úteis. Acima de 4h úteis = vermelho.
function horasUteisDesde(dataIso){
  const inicio = new Date(dataIso);
  const agora = new Date();
  let minutos = 0;
  let cursor = new Date(inicio);
  while(cursor < agora){
    const h = cursor.getHours(), m = cursor.getMinutes();
    const dentroExpediente = (h>=8 && h<13) || (h>13 || (h===13 && m>=12)) && h<18;
    if(dentroExpediente) minutos++;
    cursor = new Date(cursor.getTime()+60000);
    if(minutos>100000) break; // segurança contra loop infinito
  }
  return minutos/60;
}
function slaFaixa(op){
  const h = horasUteisDesde(op.criado_em);
  if(op.status==='Aguardando decisão da loja') return 'loja';
  if(h>=4) return 'vermelho';
  if(h>=2) return 'atencao';
  return 'verde';
}
function getSlaVermelho(){ return visibleOpps().filter(o=>!['Cancelada','Indeferida','Finalizada'].includes(o.status) && slaFaixa(o)==='vermelho'); }

// ---------------------------------------------------------------------
// 6) MODAL DE DETALHAMENTO (drill-down dos cards de KPI)
// ---------------------------------------------------------------------
function openDrill(titulo, lista){
  document.getElementById('drillTitle').textContent = titulo;
  const body = document.getElementById('drillBody');
  if(!lista || !lista.length){
    body.innerHTML = '<div class="item-empty">Nenhuma oportunidade encontrada.</div>';
  } else {
    body.innerHTML = lista.map(o=>`
      <div class="opp-card ${(o.prioridade||'').toLowerCase()}" style="grid-template-columns:110px 1fr 1fr auto" onclick="closeDrill();abrirOportunidade('${o.id}')">
        <div class="code">${o.numero}</div>
        <div><div class="info-title">Cliente</div><div class="info-value">${escapeHtml(o.cliente)}</div></div>
        <div><div class="info-title">Filial</div><div class="info-value">${escapeHtml(o.filial)}</div></div>
        <div class="badge badge-blue">${escapeHtml(o.status)}</div>
      </div>`).join('');
  }
  document.getElementById('drillModal').classList.remove('hidden');
}
function closeDrill(){ document.getElementById('drillModal').classList.add('hidden'); }

function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Abre a oportunidade certa dependendo de quem está vendo (loja -> detalhe, operação/gestor -> atendimento)
function abrirOportunidade(id){
  currentOpportunityId = id;
  const op = buscarOportunidade(id);
  if(!op) return;
  if(currentUser.perfil==='loja' || op.status==='Recebida'){
    abrirDetalhe(id);
  } else {
    abrirAtendimento(id);
  }
}

// ---------------------------------------------------------------------
// 7) TROCA DE SENHA (o usuário troca a própria senha pelo Supabase Auth)
// ---------------------------------------------------------------------
function openPasswordModal(){ document.getElementById('passwordModal').classList.remove('hidden'); }
function closePasswordModal(){
  document.getElementById('passwordModal').classList.add('hidden');
  document.getElementById('pwdAtual').value='';
  document.getElementById('pwdNova').value='';
  document.getElementById('pwdConf').value='';
}
async function savePassword(){
  const atual = document.getElementById('pwdAtual').value;
  const nova = document.getElementById('pwdNova').value;
  const conf = document.getElementById('pwdConf').value;
  if(!atual || !nova || !conf){ alert('Preencha todos os campos.'); return; }
  if(nova !== conf){ alert('A nova senha e a confirmação não coincidem.'); return; }
  if(nova.length < 8){ alert('A nova senha deve ter pelo menos 8 caracteres.'); return; }

  // Revalida a senha atual antes de trocar (evita que alguém com a sessão aberta troque sem saber a senha atual)
  const email = `${currentUser.login}@${DOMINIO_LOGIN}`;
  const { error: erroValidacao } = await supabaseClient.auth.signInWithPassword({ email, password: atual });
  if(erroValidacao){ alert('Senha atual incorreta.'); return; }

  const { error } = await supabaseClient.auth.updateUser({ password: nova });
  if(error){ alert('Erro ao trocar senha: '+error.message); return; }
  alert('Senha alterada com sucesso.');
  closePasswordModal();
}

// ---------------------------------------------------------------------
// 8) TELA DA LOJA — Minhas Oportunidades
// ---------------------------------------------------------------------
function renderLoja(filtro){
  filtro = (filtro||'').toLowerCase();
  let lista = visibleOpps();
  if(filtro){
    lista = lista.filter(o => o.numero.toLowerCase().includes(filtro) || (o.cliente||'').toLowerCase().includes(filtro));
  }
  document.getElementById('kLojaAbertas').textContent = lista.filter(o=>!['Cancelada','Indeferida','Finalizada'].includes(o.status)).length;
  document.getElementById('kLojaAtendimento').textContent = lista.filter(o=>['Em atendimento','Aguardando fornecedor','Em revisão'].includes(o.status)).length;
  document.getElementById('kLojaDecisao').textContent = lista.filter(o=>o.status==='Aguardando decisão da loja').length;
  document.getElementById('kLojaCompras').textContent = lista.filter(o=>o.status==='Encaminhada para Compras').length;

  const aguardandoAntigo = lista.some(o=>o.status==='Aguardando decisão da loja' && horasUteisDesde(o.atualizado_em) > 72);
  document.getElementById('lojaDecisionAlert').classList.toggle('hidden', !aguardandoAntigo);

  const box = document.getElementById('lojaList');
  if(!lista.length){ box.innerHTML = '<div class="item-empty">Nenhuma oportunidade encontrada.</div>'; return; }
  box.innerHTML = lista.map(o=>`
    <div class="opp-card ${(o.prioridade||'normal').toLowerCase()}" onclick="abrirOportunidade('${o.id}')">
      <div class="code">${o.numero}</div>
      <div><div class="info-title">Cliente</div><div class="info-value">${escapeHtml(o.cliente)}</div></div>
      <div><div class="info-title">Status</div><div class="info-value">${escapeHtml(o.status)}</div></div>
      <div><div class="info-title">Atualizado</div><div class="info-value">${new Date(o.atualizado_em).toLocaleString('pt-BR')}</div></div>
      <span class="badge badge-blue">${escapeHtml(o.prioridade)}</span>
    </div>`).join('');
}

// ---------------------------------------------------------------------
// 9) NOVA OPORTUNIDADE
// ---------------------------------------------------------------------
function prepararNovaOportunidade(){
  itensDraft = [];
  projetoArquivosDraft = [];
  document.getElementById('nCliente').value='';
  document.getElementById('nCpfCnpj').value='';
  document.getElementById('nVendedor').value='';
  document.getElementById('nObs').value='';
  document.getElementById('itemsBox').innerHTML = '<div class="item-empty">Nenhum item cadastrado.</div>';
  document.getElementById('nProjetoStatus').textContent = 'Nenhum arquivo anexado ainda.';
  document.querySelector('input[name="tipoOpp"][value="item"]').checked = true;
  alternarTipoOportunidade();

  const box = document.getElementById('nFilialSolicitanteBox');
  box.innerHTML = `<select id="nFilial">${FILIAIS.map(f=>`<option ${f===currentUser.filial_padrao?'selected':''}>${f}</option>`).join('')}</select>`;
}

function alternarTipoOportunidade(){
  const tipo = document.querySelector('input[name="tipoOpp"]:checked').value;
  document.getElementById('blocoItens').classList.toggle('hidden', tipo!=='item');
  document.getElementById('blocoProjeto').classList.toggle('hidden', tipo!=='projeto');
}

function renderItensDraft(){
  const box = document.getElementById('itemsBox');
  if(!itensDraft.length){ box.innerHTML = '<div class="item-empty">Nenhum item cadastrado.</div>'; return; }
  box.innerHTML = itensDraft.map((it,idx)=>`
    <div class="item-row">
      <div>
        <h4>${escapeHtml(it.descricao)}</h4>
        <div class="small muted">Qtd: ${escapeHtml(it.quantidade)} ${it.marca?(' • Marca: '+escapeHtml(it.marca)):''} ${it.referencia?(' • Ref: '+escapeHtml(it.referencia)):''}</div>
      </div>
      <button class="btn btn-outline" onclick="removerItemDraft(${idx})">Remover</button>
    </div>`).join('');
}
function removerItemDraft(idx){ itensDraft.splice(idx,1); renderItensDraft(); }

function openItemModal(){
  ['iDesc','iQtd','iMarca','iRef'].forEach(id=>document.getElementById(id).value='');
  document.getElementById('iTipo').value='';
  document.getElementById('tecnicoBox').classList.add('hidden');
  document.getElementById('iAnexoStatus').textContent = 'Envie um PDF, planilha (Excel/CSV), foto ou print do item — os itens serão adicionados automaticamente após a leitura.';
  document.getElementById('iAnexoExtras').classList.add('hidden');
  document.getElementById('itemModal').classList.remove('hidden');
}
function closeItemModal(){ document.getElementById('itemModal').classList.add('hidden'); }

function toggleTecnico(){
  const tipo = document.getElementById('iTipo').value;
  const box = document.getElementById('tecnicoBox');
  if(!tipo){ box.classList.add('hidden'); box.innerHTML=''; return; }
  const camposPorTipo = {
    cabos: [['Bitola (mm²)','iTecBitola'],['Cor','iTecCor'],['Tipo de cabo','iTecTipoCabo']],
    automacao: [['Tensão','iTecTensao'],['Protocolo','iTecProtocolo']],
    iluminacao: [['Potência (W)','iTecPotencia'],['Temperatura de cor','iTecTemperatura']]
  };
  box.innerHTML = (camposPorTipo[tipo]||[]).map(([label,id])=>`<div class="field"><label>${label}</label><input id="${id}"></div>`).join('');
  box.classList.remove('hidden');
}

function coletarDetalhesTecnicos(){
  const tipo = document.getElementById('iTipo').value;
  if(!tipo) return null;
  const detalhes = { tipo };
  document.querySelectorAll('#tecnicoBox input').forEach(inp=>{ detalhes[inp.id] = inp.value; });
  return detalhes;
}

function addItem(){
  const descricao = document.getElementById('iDesc').value.trim();
  const quantidade = document.getElementById('iQtd').value.trim();
  if(!descricao || !quantidade){ alert('Informe descrição e quantidade.'); return; }
  itensDraft.push({
    descricao, quantidade,
    marca: document.getElementById('iMarca').value.trim(),
    referencia: document.getElementById('iRef').value.trim(),
    tipo_tecnico: document.getElementById('iTipo').value || null,
    detalhes_tecnicos: coletarDetalhesTecnicos()
  });
  renderItensDraft();
  closeItemModal();
}

// Leitura automática de anexos (PDF / planilha / imagem) usando as bibliotecas já carregadas no index.html
async function processarAnexoItem(event){
  const arquivos = Array.from(event.target.files||[]);
  const statusEl = document.getElementById('iAnexoStatus');
  const extrasEl = document.getElementById('iAnexoExtras');
  if(!arquivos.length) return;
  statusEl.textContent = 'Lendo arquivo(s)...';
  let itensAdicionadosPorPlanilha = 0;
  let textoExtraido = '';

  for(const file of arquivos){
    try{
      if(file.name.match(/\.(xlsx|xls|csv)$/i)){
        const buffer = await file.arrayBuffer();
        const wb = XLSX.read(buffer, { type:'array' });
        const primeiraAba = wb.Sheets[wb.SheetNames[0]];
        const linhas = XLSX.utils.sheet_to_json(primeiraAba, { header:1 }).filter(l=>l.length && l.some(c=>String(c).trim()!==''));
        // Assume colunas: Descrição, Quantidade, Marca, Referência (pula cabeçalho se a 1ª linha não tiver números)
        linhas.forEach((linha, i)=>{
          const [descricao, quantidade, marca, referencia] = linha;
          if(i===0 && isNaN(parseFloat(quantidade))) return; // provável linha de cabeçalho
          if(descricao && quantidade){
            itensDraft.push({ descricao:String(descricao).trim(), quantidade:String(quantidade).trim(), marca: marca?String(marca).trim():'', referencia: referencia?String(referencia).trim():'', tipo_tecnico:null, detalhes_tecnicos:null });
            itensAdicionadosPorPlanilha++;
          }
        });
      } else if(file.type==='application/pdf'){
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
        let texto = '';
        for(let p=1; p<=pdf.numPages; p++){
          const pagina = await pdf.getPage(p);
          const conteudo = await pagina.getTextContent();
          texto += conteudo.items.map(it=>it.str).join(' ') + '\n';
        }
        textoExtraido += texto + '\n';
      } else if(file.type.startsWith('image/')){
        const resultado = await Tesseract.recognize(file, 'por');
        textoExtraido += resultado.data.text + '\n';
      }
    } catch(e){
      console.error('Erro lendo anexo', file.name, e);
      textoExtraido += `[Não foi possível ler ${file.name} automaticamente]\n`;
    }
  }

  renderItensDraft();

  if(itensAdicionadosPorPlanilha){
    statusEl.textContent = `${itensAdicionadosPorPlanilha} item(ns) adicionados automaticamente a partir da planilha.`;
  } else {
    statusEl.textContent = 'Leitura concluída. Preencha os campos do item manualmente.';
  }
  // O texto bruto extraído de PDF/foto não é mais exibido para o usuário
  // (ficava com aparência de "texto quebrado"/ilegível na tela).
  extrasEl.classList.add('hidden');
}

function atualizarArquivosProjeto(event){
  const arquivos = Array.from(event.target.files||[]);
  projetoArquivosDraft.push(...arquivos);
  document.getElementById('nProjetoStatus').textContent = projetoArquivosDraft.length
    ? `${projetoArquivosDraft.length} arquivo(s) selecionado(s): ${projetoArquivosDraft.map(f=>f.name).join(', ')}`
    : 'Nenhum arquivo anexado ainda.';
}

async function sendOpportunity(){
  const tipo = document.querySelector('input[name="tipoOpp"]:checked').value;
  const cliente = document.getElementById('nCliente').value.trim();
  const filial = document.getElementById('nFilial').value;
  if(!cliente){ alert('Informe o cliente.'); return; }
  if(tipo==='item' && !itensDraft.length){ alert('Adicione ao menos um item.'); return; }

  const prioridade = document.querySelector('input[name="prio"]:checked').value;

  const { data: novaOp, error } = await supabaseClient.from('oportunidades').insert({
    filial, cliente,
    cpf_cnpj: document.getElementById('nCpfCnpj').value.trim() || null,
    vendedor: document.getElementById('nVendedor').value.trim() || null,
    tipo, prioridade,
    status: 'Recebida', proxima_acao: 'Assumir',
    observacoes: document.getElementById('nObs').value.trim() || null,
    criado_por: currentUser.id
  }).select().single();

  if(error){ alert('Erro ao enviar oportunidade: '+error.message); return; }

  if(tipo==='item'){
    const linhas = itensDraft.map(it=>({ ...it, oportunidade_id: novaOp.id }));
    const { error: erroItens } = await supabaseClient.from('itens').insert(linhas);
    if(erroItens) alert('Oportunidade criada, mas houve erro ao salvar os itens: '+erroItens.message);
  } else {
    // Envia de fato cada arquivo para o Supabase Storage (bucket BUCKET_ARQUIVOS_PROJETO)
    // e só depois grava, na tabela arquivos_projeto, o caminho real de onde ele ficou
    // guardado — é esse caminho que permite ao operador abrir/baixar o arquivo depois.
    if(projetoArquivosDraft.length){
      const linhasOk = [];
      for(const file of projetoArquivosDraft){
        const caminho = `${novaOp.id}/${Date.now()}-${file.name}`;
        const { error: erroUpload } = await supabaseClient.storage.from(BUCKET_ARQUIVOS_PROJETO).upload(caminho, file);
        if(erroUpload){
          alert(`Oportunidade criada, mas houve erro ao enviar o arquivo "${file.name}": ${erroUpload.message}`);
          continue;
        }
        linhasOk.push({ oportunidade_id: novaOp.id, nome: file.name, url: caminho });
      }
      if(linhasOk.length){
        const { error: erroArquivos } = await supabaseClient.from('arquivos_projeto').insert(linhasOk);
        if(erroArquivos) alert('Arquivo(s) enviado(s), mas houve erro ao registrar no sistema: '+erroArquivos.message);
      }
    }
  }

  await registrarHistorico(novaOp.id, 'Oportunidade criada', `Por ${currentUser.nome} (${filial})`);
  await carregarOportunidades();
  alert(`Oportunidade ${novaOp.numero} enviada com sucesso.`);
  show('loja');
}

// ---------------------------------------------------------------------
// 10) TELA DE DETALHE (visão da loja sobre a própria oportunidade)
// ---------------------------------------------------------------------
function abrirDetalhe(id){
  const op = buscarOportunidade(id);
  if(!op) return;
  currentOpportunityId = id;
  document.getElementById('dNum').textContent = op.numero;
  document.getElementById('dSub').textContent = `Filial: ${op.filial} | Cliente: ${op.cliente}`;
  document.getElementById('dStatus').textContent = op.status;
  document.getElementById('dAction').textContent = op.proxima_acao || '-';
  document.getElementById('dFila').textContent = op.status==='Recebida' ? posicaoNaFila(op) : '-';
  document.getElementById('dUpdate').textContent = new Date(op.atualizado_em).toLocaleString('pt-BR');
  document.getElementById('dAlertasLoja').textContent = op.status==='Aguardando decisão da loja' ? 'Aguardando sua decisão' : '-';
  document.getElementById('dProximoAlerta').textContent = op.status==='Aguardando decisão da loja' ? 'Em 72h úteis' : '-';

  document.getElementById('dItens').innerHTML = (op.itens||[]).length
    ? op.itens.map(it=>`<div class="item-row" style="grid-template-columns:1fr"><div><h4>${escapeHtml(it.descricao)}</h4><div class="small muted">Qtd: ${escapeHtml(it.quantidade)}</div></div></div>`).join('')
    : '<div class="item-empty">Nenhum item cadastrado.</div>';

  const hist = (op.historico||[]).slice().sort((a,b)=>new Date(b.data)-new Date(a.data));
  document.getElementById('dHistorico').innerHTML = hist.length
    ? hist.map(h=>`<div class="timeline-item"><b>${escapeHtml(h.acao)}</b><div class="small muted">${new Date(h.data).toLocaleString('pt-BR')} ${h.detalhe?('— '+escapeHtml(h.detalhe)):''}</div></div>`).join('')
    : '<div class="item-empty">Sem histórico.</div>';

  document.getElementById('deleteBoxDetail').classList.toggle('hidden', !currentUser.permissoes.perm_excluir);
  document.querySelectorAll('#screen-detalhe main, #screen-detalhe').forEach(()=>{});
  show('detalhe');
}
function posicaoNaFila(op){
  const fila = visibleOpps().filter(o=>o.status==='Recebida').sort(ordenarPrioridadeFila);
  const idx = fila.findIndex(o=>o.id===op.id);
  return idx>=0 ? (idx+1)+'ª' : '-';
}

async function confirmarVendaReal(){
  const op = buscarOportunidade(currentOpportunityId);
  if(!op) return;
  await atualizarOportunidade(op.id, { status:'Encaminhada para Compras', venda_confirmada:true, proxima_acao:'Concluído' });
  await registrarHistorico(op.id, 'Venda confirmada pela loja');
  abrirDetalhe(op.id);
}
async function naoFechouVendaReal(){
  const op = buscarOportunidade(currentOpportunityId);
  if(!op) return;
  await atualizarOportunidade(op.id, { status:'Finalizada', venda_confirmada:false, proxima_acao:'Concluído' });
  await registrarHistorico(op.id, 'Loja informou que a venda não foi fechada');
  abrirDetalhe(op.id);
}

function openCancelModal(){ document.getElementById('cancelModal').classList.remove('hidden'); }
function closeCancelModal(){ document.getElementById('cancelModal').classList.add('hidden'); }
async function confirmCancel(){
  const modal = document.getElementById('cancelModal');
  const motivo = modal.querySelector('select').value;
  const justificativa = modal.querySelector('textarea').value.trim();
  const op = buscarOportunidade(currentOpportunityId);
  if(!op) return;
  await atualizarOportunidade(op.id, { status:'Cancelada', motivo, justificativa });
  await registrarHistorico(op.id, 'Oportunidade cancelada', motivo + (justificativa?(' — '+justificativa):''));
  closeCancelModal();
  abrirDetalhe(op.id);
}

// ---------------------------------------------------------------------
// 11) FILA OPERACIONAL (Kanban)
// ---------------------------------------------------------------------
function ordenarPrioridadeFila(a,b){
  const peso = { 'Urgente':4, 'Alta':3, 'Média':2, 'Normal':1 };
  const slaA = slaFaixa(a)==='vermelho'?2:(slaFaixa(a)==='atencao'?1:0);
  const slaB = slaFaixa(b)==='vermelho'?2:(slaFaixa(b)==='atencao'?1:0);
  if(slaA!==slaB) return slaB-slaA;
  if(peso[b.prioridade]!==peso[a.prioridade]) return (peso[b.prioridade]||0)-(peso[a.prioridade]||0);
  return new Date(a.criado_em)-new Date(b.criado_em);
}

function renderLucas(){
  // Botão "Voltar ao dashboard" só faz sentido para quem tem dashboard (perm_dashboard).
  // Um usuário de Operação puro (sem essa permissão) cai direto na Fila Operacional
  // como tela inicial, então não há "dashboard" para voltar.
  const btnVoltarDashboard = document.getElementById('backDashboardBtn');
  if(btnVoltarDashboard){
    const temDashboard = !!(currentUser && currentUser.permissoes && currentUser.permissoes.perm_dashboard);
    btnVoltarDashboard.classList.toggle('hidden', !temDashboard);
  }
  // Usuário de Loja ou de Apoio não tem Dashboard para voltar — para eles, o
  // botão "Voltar" leva de volta para a tela de Nova Oportunidade ("Minhas Oportunidades").
  const btnVoltarLoja = document.getElementById('backLojaBtn');
  if(btnVoltarLoja){
    btnVoltarLoja.classList.toggle('hidden', !(currentUser && (currentUser.perfil==='loja' || currentUser.perfil==='apoio')));
  }

  // lista: usada nos KPIs/gráficos "em aberto" — comportamento idêntico ao que já existia
  // (Finalizada continua fora das métricas de fila em aberto).
  let lista = visibleOpps().filter(o=>!['Cancelada','Indeferida','Finalizada'].includes(o.status));
  // listaComFinalizadas: mesma coisa, mas incluindo os itens Finalizados — usada apenas
  // para alimentar as colunas do quadro (para a coluna "Finalizado" ter o que mostrar).
  let listaComFinalizadas = visibleOpps().filter(o=>!['Cancelada','Indeferida'].includes(o.status));

  const filtros = {
    fila: o=>o.status==='Recebida',
    andamento: o=>['Em atendimento','Em revisão'].includes(o.status),
    loja: o=>o.status==='Aguardando decisão da loja',
    fornecedor: o=>o.status==='Aguardando fornecedor',
    finalizado: o=>o.status==='Finalizada'
  };
  const listaFiltrada = lucasFilterAtual==='todos' ? listaComFinalizadas : listaComFinalizadas.filter(filtros[lucasFilterAtual]);

  document.getElementById('kLucasRecebidas').textContent = lista.filter(filtros.fila).length;
  document.getElementById('kLucasRespondidas').textContent = visibleOpps().filter(o=>o.status==='Respondida').length;
  document.getElementById('kLucasEncaminhadas').textContent = visibleOpps().filter(o=>o.status==='Encaminhada para Compras').length;
  document.getElementById('kLucasSlaVermelho').textContent = getSlaVermelho().length;
  document.getElementById('kLucasAguardandoLoja').textContent = lista.filter(filtros.loja).length;
  document.getElementById('kLucasAguardandoFornecedor').textContent = lista.filter(filtros.fornecedor).length;

  document.getElementById('chartLucasFila').textContent = lista.filter(filtros.fila).length;
  document.getElementById('chartLucasAtendimento').textContent = lista.filter(filtros.andamento).length;
  document.getElementById('chartLucasFornecedor').textContent = lista.filter(filtros.fornecedor).length;
  document.getElementById('chartLucasLoja').textContent = lista.filter(filtros.loja).length;
  ['Urgente','Alta','Média','Normal'].forEach(p=>{
    const id = 'chartPrio'+(p==='Média'?'Media':p);
    document.getElementById(id).textContent = lista.filter(o=>o.prioridade===p).length;
  });

  const colunas = { lucasFila: filtros.fila, lucasAndamento: filtros.andamento, lucasFornecedor: filtros.fornecedor, lucasLoja: filtros.loja, lucasFinalizado: filtros.finalizado };
  Object.entries(colunas).forEach(([elId, fn])=>{
    const itens = listaFiltrada.filter(fn).sort(ordenarPrioridadeFila);
    const el = document.getElementById(elId);
    el.innerHTML = itens.length ? itens.map(o=>`
      <div class="task" draggable="true" data-id="${o.id}" ondragstart="event.dataTransfer.setData('text/plain','${o.id}')" onclick="abrirOportunidade('${o.id}')">
        <div class="task-top"><span class="task-code">${o.numero}</span><span class="badge ${slaFaixa(o)==='vermelho'?'badge-red':(slaFaixa(o)==='atencao'?'badge-orange':'badge-blue')}">${o.prioridade}</span></div>
        <div class="small">${escapeHtml(o.cliente)}</div>
        <div class="small muted">${escapeHtml(o.filial)}</div>
      </div>`).join('') : '<div class="small muted" style="padding:10px">Vazio</div>';
  });

  document.querySelectorAll('.column').forEach(col=>{
    col.ondragover = e=>{ e.preventDefault(); col.classList.add('drop-hover'); };
    col.ondragleave = ()=>col.classList.remove('drop-hover');
    col.ondrop = async e=>{
      e.preventDefault(); col.classList.remove('drop-hover');
      const id = e.dataTransfer.getData('text/plain');
      const destino = col.querySelector('[id^="lucas"]')?.id;
      const statusPorColuna = { lucasFila:'Recebida', lucasAndamento:'Em atendimento', lucasFornecedor:'Aguardando fornecedor', lucasLoja:'Aguardando decisão da loja', lucasFinalizado:'Finalizada' };
      if(destino && statusPorColuna[destino]){
        await atualizarOportunidade(id, { status: statusPorColuna[destino] });
        await registrarHistorico(id, 'Status alterado via fila', statusPorColuna[destino]);
        renderLucas();
      }
    };
  });
}

function setLucasFilter(filtro, botao){
  lucasFilterAtual = filtro;
  document.querySelectorAll('#screen-lucas .filter-pills .pill').forEach(p=>p.classList.remove('active'));
  botao.classList.add('active');
  renderLucas();
}

async function assumirProxima(){
  const fila = visibleOpps().filter(o=>o.status==='Recebida').sort(ordenarPrioridadeFila);
  if(!fila.length){ alert('Não há oportunidades na fila.'); return; }
  const proxima = fila[0];
  await atualizarOportunidade(proxima.id, { status:'Em atendimento', proxima_acao:'Cadastrar ERP', comprador: currentUser.nome });
  await registrarHistorico(proxima.id, 'Oportunidade assumida', currentUser.nome);
  abrirAtendimento(proxima.id);
}

// ---------------------------------------------------------------------
// 12) TELA DE ATENDIMENTO (Operação)
// ---------------------------------------------------------------------

// Gera, para cada arquivo de projeto anexado pela loja, um link temporário
// (válido por 1h) de acesso ao arquivo guardado no Supabase Storage, e
// preenche a lista na tela de atendimento. Roda em segundo plano (não
// trava a abertura da tela) e trata graciosamente arquivos antigos que
// foram cadastrados antes desta correção (sem caminho salvo no Storage).
async function carregarLinksArquivosProjeto(arquivos){
  const el = document.getElementById('aArquivosProjeto');
  if(!el) return;
  if(!arquivos.length){ el.textContent = 'Nenhum arquivo.'; return; }
  el.textContent = 'Carregando link(s) do(s) arquivo(s)...';
  const linhas = await Promise.all(arquivos.map(async a=>{
    if(!a.url){
      return `${escapeHtml(a.nome)} <span class="small muted">(arquivo enviado antes desta correção — peça para a loja reenviar)</span>`;
    }
    const { data, error } = await supabaseClient.storage.from(BUCKET_ARQUIVOS_PROJETO).createSignedUrl(a.url, 3600);
    if(error || !data){
      return `${escapeHtml(a.nome)} <span class="small muted">(não foi possível gerar o link: ${escapeHtml(error?.message||'erro desconhecido')})</span>`;
    }
    return `<a href="${data.signedUrl}" target="_blank" rel="noopener">${escapeHtml(a.nome)}</a>`;
  }));
  el.innerHTML = linhas.join('<br>');
}

// Monta as opções do "Comprador responsável" a partir da lista cadastrada
// (compradoresCache). Se o valor já salvo na oportunidade não estiver mais
// na lista (por exemplo, foi removido depois), ele é mantido como opção
// extra só para não perder a informação já registrada.
function preencherSelectComprador(nomeAtual){
  const select = document.getElementById('aComprador');
  if(!select) return;
  const nomes = compradoresCache.map(c=>c.nome);
  if(nomeAtual && !nomes.includes(nomeAtual)) nomes.unshift(nomeAtual);
  select.innerHTML = '<option value="">Selecione...</option>' + nomes.map(n=>`<option ${n===nomeAtual?'selected':''}>${escapeHtml(n)}</option>`).join('');
}

function abrirAtendimento(id){
  const op = buscarOportunidade(id);
  if(!op) return;
  currentOpportunityId = id;
  document.getElementById('aNum').textContent = op.numero;
  document.getElementById('aSub').textContent = `Filial: ${op.filial} | Cliente: ${op.cliente}`;

  const primeiroItem = (op.itens||[])[0];
  document.getElementById('blocoItemPadraoAtendimento').classList.toggle('hidden', op.tipo==='projeto');
  document.getElementById('blocoProjetoAtendimento').classList.toggle('hidden', op.tipo!=='projeto');
  if(primeiroItem){
    document.getElementById('aItemDesc').textContent = primeiroItem.descricao;
    document.getElementById('aItemQtd').textContent = primeiroItem.quantidade;
    document.getElementById('aItemMarca').textContent = primeiroItem.marca || '-';
    document.getElementById('aItemRef').textContent = primeiroItem.referencia || '-';
  }
  const extras = (op.itens||[]).slice(1);
  const extrasEl = document.getElementById('aItensExtras');
  if(extras.length){
    extrasEl.textContent = `+ ${extras.length} item(ns) adicional(is): ` + extras.map(i=>`${i.descricao} (${i.quantidade})`).join('; ');
    extrasEl.classList.remove('hidden');
  } else extrasEl.classList.add('hidden');

  carregarLinksArquivosProjeto(op.arquivos_projeto || []);
  document.getElementById('aCodigoEletroluz').value = op.codigo_eletroluz || '';
  preencherSelectComprador(op.comprador || '');
  document.getElementById('acaoAtualBox').textContent = op.proxima_acao || '-';
  document.getElementById('aResposta').value = op.resposta_loja || '';

  const horas = horasUteisDesde(op.criado_em);
  document.getElementById('aSlaTempo').textContent = horas.toFixed(1)+'h';
  const faixa = slaFaixa(op);
  document.getElementById('aSlaFaixa').textContent = { verde:'Dentro do prazo', atencao:'Atenção', vermelho:'Fora do SLA', loja:'Aguardando loja' }[faixa];

  const fornecedores = op.fornecedores_cotados||[];
  document.getElementById('aFornecedoresBody').innerHTML = fornecedores.map(f=>`
    <tr><td>${escapeHtml(f.fornecedor)}</td><td>${escapeHtml(f.valor)}</td><td>${escapeHtml(f.prazo)}</td><td>${escapeHtml(f.condicao)}</td></tr>`).join('');
  document.getElementById('aHistoricoCotacoes').innerHTML = fornecedores.length
    ? fornecedores.map(f=>`<div class="timeline-item"><b>${escapeHtml(f.fornecedor)}</b><div class="small muted">${escapeHtml(f.valor)} • ${escapeHtml(f.prazo)}</div></div>`).join('')
    : '<div class="item-empty">Nenhuma cotação registrada ainda.</div>';

  document.getElementById('btnEnviarIndustria').classList.toggle('hidden', op.tipo!=='projeto');
  document.getElementById('deleteBoxAtendimento').classList.toggle('hidden', !currentUser.permissoes.perm_excluir);

  const clienteOpsAnteriores = oportunidades.filter(o=>o.cliente===op.cliente && o.id!==op.id);
  const alertaCliente = document.getElementById('atendimentoClienteAlerta');
  if(clienteOpsAnteriores.length>=3){
    alertaCliente.textContent = `Atenção: este cliente já solicitou cotação ${clienteOpsAnteriores.length} vez(es) antes. Verifique risco de uso apenas como comparação de preço.`;
    alertaCliente.classList.remove('hidden');
  } else alertaCliente.classList.add('hidden');

  show('atendimento');
}

async function setAcaoAtual(acao){
  const op = buscarOportunidade(currentOpportunityId);
  if(!op) return;
  const statusPorAcao = {
    'Cobrar fornecedor':'Aguardando fornecedor',
    'Enviar para indústria':'Aguardando fornecedor',
    'Registrar retorno':'Em atendimento',
    'Responder loja':'Aguardando decisão da loja',
    'Revisar cotação':'Em revisão'
  };
  await atualizarOportunidade(op.id, { status: statusPorAcao[acao] || op.status, proxima_acao: acao });
  await registrarHistorico(op.id, 'Próxima ação definida', acao);
  abrirAtendimento(op.id);
}

async function salvarCodigoEletroluz(){
  const op = buscarOportunidade(currentOpportunityId); if(!op) return;
  await atualizarOportunidade(op.id, { codigo_eletroluz: document.getElementById('aCodigoEletroluz').value.trim() });
}
async function salvarComprador(){
  const op = buscarOportunidade(currentOpportunityId); if(!op) return;
  await atualizarOportunidade(op.id, { comprador: document.getElementById('aComprador').value });
}
async function salvarRespostaLoja(){
  const op = buscarOportunidade(currentOpportunityId); if(!op) return;
  await atualizarOportunidade(op.id, { resposta_loja: document.getElementById('aResposta').value.trim() });
}
async function adicionarFornecedorCotado(){
  const op = buscarOportunidade(currentOpportunityId); if(!op) return;
  const fornecedor = prompt('Nome do fornecedor:'); if(!fornecedor) return;
  const valor = prompt('Valor cotado:') || '';
  const prazo = prompt('Prazo de entrega:') || '';
  const condicao = prompt('Condição de pagamento:') || '';
  await supabaseClient.from('fornecedores_cotados').insert({ oportunidade_id: op.id, fornecedor, valor, prazo, condicao });
  await registrarHistorico(op.id, 'Cotação registrada', `${fornecedor} — ${valor}`);
  await carregarOportunidades();
  abrirAtendimento(op.id);
}

function openIndeferirModal(){ document.getElementById('indeferirModal').classList.remove('hidden'); }
function closeIndeferirModal(){ document.getElementById('indeferirModal').classList.add('hidden'); }
async function confirmIndeferir(){
  const modal = document.getElementById('indeferirModal');
  const motivo = modal.querySelector('select').value;
  const justificativa = modal.querySelector('textarea').value.trim();
  const op = buscarOportunidade(currentOpportunityId); if(!op) return;
  await atualizarOportunidade(op.id, { status:'Indeferida', motivo, justificativa });
  await registrarHistorico(op.id, 'Solicitação indeferida', motivo + (justificativa?(' — '+justificativa):''));
  closeIndeferirModal();
  show('lucas');
}

async function deleteCurrentOpportunity(){
  if(!currentUser.permissoes.perm_excluir){ alert('Você não tem permissão para excluir.'); return; }
  if(!confirm('Excluir esta solicitação de teste? Essa ação não pode ser desfeita.')) return;
  const { error } = await supabaseClient.from('oportunidades').delete().eq('id', currentOpportunityId);
  if(error){ alert('Erro ao excluir: '+error.message); return; }
  await carregarOportunidades();
  show(currentUser.perfil==='loja' ? 'loja' : 'lucas');
}

// ---------------------------------------------------------------------
// 13) DASHBOARD DO GESTOR
// ---------------------------------------------------------------------
function atualizarDashboardGestor(){
  const lista = visibleOpps();
  const finalizadas = lista.filter(o=>o.venda_confirmada!==null);
  const convertidas = lista.filter(o=>o.venda_confirmada===true);
  const revisadas = lista.filter(o=>o.status==='Em revisão' || (o.historico||[]).some(h=>h.acao==='Próxima ação definida' && h.detalhe==='Revisar cotação'));
  const indeferidas = lista.filter(o=>o.status==='Indeferida');

  document.getElementById('execRecebidas').textContent = lista.length;
  document.getElementById('execConversao').textContent = finalizadas.length ? Math.round(100*convertidas.length/finalizadas.length)+'%' : '0%';
  document.getElementById('execRevisoes').textContent = lista.length ? Math.round(100*revisadas.length/lista.length)+'%' : '0%';
  document.getElementById('execIndeferimentos').textContent = lista.length ? Math.round(100*indeferidas.length/lista.length)+'%' : '0%';

  document.getElementById('kGestorRecebidas').textContent = getByStatus('Recebida').length;
  document.getElementById('kGestorRespondidas').textContent = getByStatus('Respondida').length;
  document.getElementById('kGestorEncaminhadas').textContent = getByStatus('Encaminhada para Compras').length;
  document.getElementById('kGestorAtendimento').textContent = getEmAtendimento().length;
  document.getElementById('kGestorAguardandoLoja').textContent = getByStatus('Aguardando decisão da loja').length;
  document.getElementById('kGestorConversao').textContent = document.getElementById('execConversao').textContent;
  document.getElementById('kGestorRevisoes').textContent = revisadas.length;
  document.getElementById('kGestorIndeferidas').textContent = indeferidas.length;

  document.getElementById('chartRecebida').textContent = getByStatus('Recebida').length;
  document.getElementById('chartAtendimento').textContent = lista.filter(o=>o.status==='Em atendimento').length;
  document.getElementById('chartFornecedor').textContent = getByStatus('Aguardando fornecedor').length;
  document.getElementById('chartLoja').textContent = getByStatus('Aguardando decisão da loja').length;
  document.getElementById('chartCompras').textContent = getByStatus('Encaminhada para Compras').length;

  const ativos = lista.filter(o=>!['Cancelada','Indeferida','Finalizada'].includes(o.status));
  const verde = ativos.filter(o=>slaFaixa(o)==='verde').length;
  const atencao = ativos.filter(o=>slaFaixa(o)==='atencao').length;
  const aguardLoja = ativos.filter(o=>slaFaixa(o)==='loja').length;
  const vermelho = ativos.filter(o=>slaFaixa(o)==='vermelho').length;
  document.getElementById('donutTotal').textContent = ativos.length;
  document.getElementById('chartSlaVerde').textContent = verde;
  document.getElementById('chartSlaAtencao').textContent = atencao;
  document.getElementById('chartSlaLoja').textContent = aguardLoja;
  document.getElementById('chartSlaVermelho').textContent = vermelho;
  document.getElementById('kGestorSlaVerde').textContent = verde;
  document.getElementById('kGestorSlaAtencao').textContent = atencao;
  document.getElementById('kGestorSlaVermelho').textContent = vermelho;

  document.getElementById('kGargaloFornecedor').textContent = getByAction('Cobrar fornecedor').length;
  document.getElementById('kGargaloResponder').textContent = getByAction('Responder loja').length;
  document.getElementById('kGargaloERP').textContent = getByAction('Cadastrar ERP').length;
  document.getElementById('kGargaloRevisao').textContent = getByAction('Revisar cotação').length;

  const porFilial = {};
  lista.forEach(o=>{ porFilial[o.filial] = (porFilial[o.filial]||0)+1; });
  const filiaisOrdenadas = Object.entries(porFilial).sort((a,b)=>b[1]-a[1]);
  document.getElementById('chartVolumeFilial').innerHTML = filiaisOrdenadas.length
    ? '<table><tbody>'+filiaisOrdenadas.map(([f,c])=>`<tr><td>${escapeHtml(f)}</td><td style="text-align:right"><b>${c}</b></td></tr>`).join('')+'</tbody></table>'
    : 'Sem dados ainda.';

  const contagemItens = {};
  lista.filter(o=>o.tipo==='item').forEach(o=>(o.itens||[]).forEach(it=>{
    const chave = it.descricao.trim().toLowerCase();
    contagemItens[chave] = (contagemItens[chave]||0)+1;
  }));
  const recorrentes = Object.entries(contagemItens).filter(([,c])=>c>1).sort((a,b)=>b[1]-a[1]).slice(0,8);
  document.getElementById('chartItensRecorrentes').innerHTML = recorrentes.length
    ? '<table><tbody>'+recorrentes.map(([desc,c])=>`<tr><td>${escapeHtml(desc)}</td><td style="text-align:right"><b>${c}x</b></td></tr>`).join('')+'</tbody></table>'
    : 'Sem dados ainda.';
}

// ---------------------------------------------------------------------
// 14) FOLLOW-UP DE ESTOQUE
// ---------------------------------------------------------------------
function renderEstoque(){
  const mapa = {};
  oportunidades.filter(o=>o.tipo==='item').forEach(op=>{
    (op.itens||[]).forEach(it=>{
      const chave = it.descricao.trim().toLowerCase();
      if(!mapa[chave]) mapa[chave] = { descricao: it.descricao, cotacoes:0, filiais:new Set(), ultimoFornecedor:'-', ultimoValor:'-', dataUltima:null };
      mapa[chave].cotacoes++;
      mapa[chave].filiais.add(op.filial);
      const ultimoFornecedor = (op.fornecedores_cotados||[]).slice(-1)[0];
      if(ultimoFornecedor && (!mapa[chave].dataUltima || new Date(op.atualizado_em) > mapa[chave].dataUltima)){
        mapa[chave].ultimoFornecedor = ultimoFornecedor.fornecedor;
        mapa[chave].ultimoValor = ultimoFornecedor.valor;
        mapa[chave].dataUltima = new Date(op.atualizado_em);
      }
    });
  });
  const candidatos = Object.values(mapa).filter(m=>m.cotacoes>1).sort((a,b)=>b.cotacoes-a.cotacoes);
  document.getElementById('estoqueAlert').classList.toggle('hidden', candidatos.length===0);
  if(candidatos.length) document.getElementById('estoqueAlert').textContent = `${candidatos.length} item(ns) fora do portfólio com potencial para virar item de estoque padrão.`;
  document.getElementById('estoqueBody').innerHTML = candidatos.map(c=>`
    <tr>
      <td>${escapeHtml(c.descricao)}</td><td>${c.cotacoes}</td><td>${Array.from(c.filiais).join(', ')}</td>
      <td>${escapeHtml(c.ultimoFornecedor)}</td><td>${escapeHtml(c.ultimoValor)}</td>
      <td><span class="badge badge-blue">Candidato</span></td>
      <td><button class="btn btn-light" onclick="alert('Marcado para avaliação de Compras: ${escapeHtml(c.descricao)}')">Avaliar</button></td>
    </tr>`).join('') || '<tr><td colspan="7">Sem dados ainda.</td></tr>';
}
function exportarFollowUpEstoque(){
  const linhas = Array.from(document.querySelectorAll('#estoqueBody tr')).map(tr=>Array.from(tr.children).slice(0,5).map(td=>td.textContent));
  if(!linhas.length || !linhas[0].length){ alert('Não há itens para exportar.'); return; }
  const ws = XLSX.utils.aoa_to_sheet([['Item','Cotações','Filiais','Último fornecedor','Último valor'], ...linhas]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Follow-up Estoque');
  XLSX.writeFile(wb, 'followup-estoque.xlsx');
}

// ---------------------------------------------------------------------
// 15) CLIENTES
// ---------------------------------------------------------------------
function renderClientes(){
  const mapa = {};
  oportunidades.forEach(o=>{
    const chave = o.cliente + '|' + (o.cpf_cnpj||'');
    if(!mapa[chave]) mapa[chave] = { cliente:o.cliente, cpf:o.cpf_cnpj||'-', solicitacoes:0, vendas:0, naoFechou:0 };
    mapa[chave].solicitacoes++;
    if(o.venda_confirmada===true) mapa[chave].vendas++;
    if(o.venda_confirmada===false) mapa[chave].naoFechou++;
  });
  const linhas = Object.values(mapa).sort((a,b)=>b.solicitacoes-a.solicitacoes);
  document.getElementById('clientesBody').innerHTML = linhas.map(c=>{
    const taxa = c.solicitacoes ? Math.round(100*c.vendas/c.solicitacoes) : 0;
    const risco = (c.solicitacoes>=3 && taxa<20) ? '<span class="badge badge-red">Alto</span>' : (c.solicitacoes>=3 && taxa<50 ? '<span class="badge badge-yellow">Médio</span>' : '<span class="badge badge-blue">Baixo</span>');
    return `<tr><td>${escapeHtml(c.cliente)}</td><td>${escapeHtml(c.cpf)}</td><td>${c.solicitacoes}</td><td>${c.vendas}</td><td>${c.naoFechou}</td><td>${taxa}%</td><td>${risco}</td></tr>`;
  }).join('') || '<tr><td colspan="7">Sem dados ainda.</td></tr>';
}

// ---------------------------------------------------------------------
// 16) ADMINISTRAÇÃO DE USUÁRIOS
// IMPORTANTE: criar usuário, resetar senha e inativar/ativar são operações
// sensíveis que exigem privilégio de administrador do Supabase Auth.
// Por segurança, elas NÃO são feitas direto do navegador — o navegador
// nunca deve ter permissão de admin. Elas chamam a Edge Function
// "admin-users" (veja supabase/functions/admin-users e SETUP.md), que
// roda no servidor do Supabase com a service_role key protegida.
// ---------------------------------------------------------------------
const ICONE_LIXEIRA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path></svg>';
const ICONE_RENOMEAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>';
const ICONE_CHAVE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"></path><path d="m21 2-9.6 9.6"></path><circle cx="7.5" cy="15.5" r="5.5"></circle></svg>';
const ICONE_PAUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="10" y1="15" x2="10" y2="9"></line><line x1="14" y1="15" x2="14" y2="9"></line></svg>';
const ICONE_PLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polygon points="10 8 16 12 10 16 10 8"></polygon></svg>';

// Menu "⋯" de ações secundárias da tabela de usuários (Renomear, Resetar
// senha, Ativar/Inativar, Excluir), para reduzir a poluição visual de
// vários botões lado a lado.
function toggleUserActionsMenu(event, userId){
  event.stopPropagation();
  document.querySelectorAll('.actions-menu-panel').forEach(painel=>{
    if(painel.id !== 'actionsMenu-'+userId) painel.classList.add('hidden');
  });
  document.getElementById('actionsMenu-'+userId)?.classList.toggle('hidden');
}
function fecharUserActionsMenu(userId){
  document.getElementById('actionsMenu-'+userId)?.classList.add('hidden');
}
document.addEventListener('click', (e)=>{
  document.querySelectorAll('.actions-menu-panel:not(.hidden)').forEach(painel=>{
    if(!painel.parentElement.contains(e.target)) painel.classList.add('hidden');
  });
});

async function renderAdminUsers(){
  const { data, error } = await supabaseClient.from('profiles').select('*').order('nome');
  if(error){ alert('Erro ao carregar usuários: '+error.message); return; }
  profilesCache = data || [];

  const termo = (document.getElementById('adminUserSearch').value||'').toLowerCase();
  let lista = profilesCache.filter(u =>
    u.login.toLowerCase().includes(termo) || u.nome.toLowerCase().includes(termo) || (u.filial_padrao||'').toLowerCase().includes(termo));
  if(adminPerfilFilterAtual!=='todos') lista = lista.filter(u=>u.perfil===adminPerfilFilterAtual);
  if(adminStatusFilterAtual!=='todos') lista = lista.filter(u=>adminStatusFilterAtual==='ativo' ? u.ativo : !u.ativo);

  document.getElementById('adminUsersBody').innerHTML = lista.map(u=>`
    <tr>
      <td>${escapeHtml(u.login)}</td>
      <td>${escapeHtml(u.nome)}</td>
      <td>${PERFIL_LABEL[u.perfil]||u.perfil}</td>
      <td>${escapeHtml(u.filial_padrao||'-')}</td>
      <td><button class="btn btn-light" onclick="openPermissoesModal('${u.id}')">Ver/editar</button></td>
      <td><span class="user-status ${u.ativo?'active':'inactive'}">${u.ativo?'Ativo':'Inativo'}</span></td>
      <td>
        <div class="actions-menu">
          <button class="btn-kebab" title="Mais ações" onclick="toggleUserActionsMenu(event,'${u.id}')">⋯</button>
          <div class="actions-menu-panel hidden" id="actionsMenu-${u.id}">
            <button onclick="fecharUserActionsMenu('${u.id}'); openRenameModal('${u.id}')">${ICONE_RENOMEAR} Renomear</button>
            <button onclick="fecharUserActionsMenu('${u.id}'); openResetModal('${u.id}')">${ICONE_CHAVE} Resetar senha</button>
            <button onclick="fecharUserActionsMenu('${u.id}'); alternarAtivoUsuario('${u.id}', ${!u.ativo})">${u.ativo?ICONE_PAUSE:ICONE_PLAY} ${u.ativo?'Inativar':'Ativar'}</button>
            ${currentUser && u.id!==currentUser.id ? `<button class="danger" onclick="fecharUserActionsMenu('${u.id}'); confirmarExclusaoUsuario('${u.id}')">${ICONE_LIXEIRA} Excluir</button>` : ''}
          </div>
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="7">Nenhum usuário encontrado.</td></tr>';
}

// Exclusão definitiva de usuário (login + perfil). Usa a mesma permissão
// de "Inativar/retirar usuário" já existente, para não precisar criar uma
// nova permissão no modal de Permissões.
async function confirmarExclusaoUsuario(userId){
  const u = profilesCache.find(p=>p.id===userId);
  const rotulo = u ? `${u.nome} (${u.login})` : 'este usuário';
  if(!confirm(`Tem certeza que deseja EXCLUIR definitivamente ${rotulo}?\n\nEssa ação não pode ser desfeita: o login de acesso e o cadastro serão removidos.`)) return;
  const resultado = await chamarAdminUsers({ acao:'excluir_usuario', user_id:userId });
  if(!resultado) return;
  alert('Usuário excluído com sucesso.');
  renderAdminUsers();
}
function setAdminPerfilFilter(perfil, botao){
  adminPerfilFilterAtual = perfil;
  document.querySelectorAll('#adminPerfilPills .pill').forEach(p=>p.classList.remove('active'));
  botao.classList.add('active');
  renderAdminUsers();
}
function setAdminStatusFilter(status, botao){
  adminStatusFilterAtual = status;
  document.querySelectorAll('#adminStatusPills .pill').forEach(p=>p.classList.remove('active'));
  botao.classList.add('active');
  renderAdminUsers();
}

// Chamada padrão para a Edge Function de administração
async function chamarAdminUsers(payload){
  const { data, error } = await supabaseClient.functions.invoke('admin-users', { body: payload });
  if(error){ alert('Erro: '+(error.message||error)); return null; }
  if(data && data.error){ alert('Erro: '+data.error); return null; }
  return data;
}

// --- Novo usuário ---
function gerarLoginSugerido(nome){
  const partes = nome.trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'') // remove acentos
    .split(/\s+/).filter(Boolean);
  if(!partes.length) return '';
  return partes.length===1 ? partes[0] : (partes[0] + '.' + partes[partes.length-1]);
}
function atualizarPreviaLogin(){
  const nome = document.getElementById('novoUserNome').value;
  document.getElementById('novoUserLoginPreview').textContent = gerarLoginSugerido(nome) || '—';
}
function openNovoUsuarioModal(){
  document.getElementById('novoUserNome').value='';
  document.getElementById('novoUserSenha').value='';
  document.getElementById('novoUserLoginPreview').textContent='—';
  document.getElementById('novoUsuarioModal').classList.remove('hidden');
}
function closeNovoUsuarioModal(){ document.getElementById('novoUsuarioModal').classList.add('hidden'); }
async function saveNovoUsuario(){
  const nome = document.getElementById('novoUserNome').value.trim();
  const senha = document.getElementById('novoUserSenha').value;
  const perfilLabel = document.getElementById('novoUserPerfil').value;
  const filial = document.getElementById('novoUserFilial').value;
  const login = gerarLoginSugerido(nome);
  if(!nome || !senha || !login){ alert('Preencha nome e senha provisória.'); return; }
  if(senha.length < 8){ alert('A senha provisória deve ter pelo menos 8 caracteres.'); return; }
  const perfilMap = { 'Loja':'loja', 'Operação':'lucas', 'Gestor':'gestor', 'Apoio':'apoio' };
  const perfil = perfilMap[perfilLabel] || 'loja';

  const resultado = await chamarAdminUsers({
    acao: 'criar_usuario', nome, login, senha, perfil, filial_padrao: filial,
    permissoes: permissoesPadrao(perfil)
  });
  if(!resultado) return;
  alert('Usuário cadastrado com sucesso.');
  closeNovoUsuarioModal();
  renderAdminUsers();
}

// --- Reset de senha ---
function openResetModal(userId){
  adminUsuarioSelecionadoId = userId;
  const u = profilesCache.find(p=>p.id===userId);
  document.getElementById('resetUserLabel').textContent = u ? `Usuário: ${u.nome} (${u.login})` : '';
  document.getElementById('resetNova').value=''; document.getElementById('resetConf').value='';
  document.getElementById('resetModal').classList.remove('hidden');
}
function closeResetModal(){ document.getElementById('resetModal').classList.add('hidden'); }
async function saveReset(){
  const nova = document.getElementById('resetNova').value;
  const conf = document.getElementById('resetConf').value;
  if(!nova || nova!==conf){ alert('As senhas não coincidem.'); return; }
  if(nova.length<8){ alert('A senha deve ter pelo menos 8 caracteres.'); return; }
  const resultado = await chamarAdminUsers({ acao:'resetar_senha', user_id: adminUsuarioSelecionadoId, nova_senha: nova });
  if(!resultado) return;
  alert('Senha resetada com sucesso.');
  closeResetModal();
}

// --- Renomear ---
function openRenameModal(userId){
  adminUsuarioSelecionadoId = userId;
  const u = profilesCache.find(p=>p.id===userId);
  document.getElementById('renameUserLabel').textContent = u ? `Usuário: ${u.login}` : '';
  document.getElementById('renameNovoNome').value = u ? u.nome : '';
  document.getElementById('renameModal').classList.remove('hidden');
}
function closeRenameModal(){ document.getElementById('renameModal').classList.add('hidden'); }
async function saveRename(){
  const novoNome = document.getElementById('renameNovoNome').value.trim();
  if(!novoNome){ alert('Informe o novo nome.'); return; }
  const { error } = await supabaseClient.from('profiles').update({ nome: novoNome }).eq('id', adminUsuarioSelecionadoId);
  if(error){ alert('Erro: '+error.message); return; }
  closeRenameModal();
  renderAdminUsers();
}

// --- Ativar/Inativar ---
async function alternarAtivoUsuario(userId, novoStatus){
  const resultado = await chamarAdminUsers({ acao:'definir_ativo', user_id:userId, ativo: novoStatus });
  if(!resultado) return;
  renderAdminUsers();
}

// --- Permissões ---
const TODAS_PERMS = ['perm_abrir','perm_consultar_proprias','perm_confirmar_venda','perm_solicitar_revisao','perm_cancelar','perm_nao_fechou',
  'perm_fila','perm_assumir','perm_cotar','perm_responder','perm_indeferir','perm_excluir',
  'perm_dashboard','perm_usuarios','perm_resetar','perm_inativar','perm_sla','perm_todas_filiais'];
function openPermissoesModal(userId){
  adminUsuarioSelecionadoId = userId;
  const u = profilesCache.find(p=>p.id===userId);
  document.getElementById('permUserLabel').textContent = u ? `${u.nome} — ${PERFIL_LABEL[u.perfil]}` : '';
  TODAS_PERMS.forEach(p=>{ document.getElementById(p).checked = !!(u && u.permissoes && u.permissoes[p]); });
  document.getElementById('permissoesModal').classList.remove('hidden');
}
function closePermissoesModal(){ document.getElementById('permissoesModal').classList.add('hidden'); }
async function savePermissoes(){
  const permissoes = {};
  TODAS_PERMS.forEach(p=>{ permissoes[p] = document.getElementById(p).checked; });
  const { error } = await supabaseClient.from('profiles').update({ permissoes }).eq('id', adminUsuarioSelecionadoId);
  if(error){ alert('Erro: '+error.message); return; }
  closePermissoesModal();
  renderAdminUsers();
}

// --- Compradores responsáveis (só aparece na tela de Administração,
// já restrita a Gestor/Administração pela permissão perm_usuarios) ---
function renderCompradoresAdmin(){
  const body = document.getElementById('compradoresBody');
  if(!body) return;
  body.innerHTML = compradoresCache.length
    ? compradoresCache.map(c=>`
      <div class="status-line">
        <span>${escapeHtml(c.nome)}</span>
        <button class="btn btn-outline" style="padding:4px 10px;font-size:12px" onclick="removerComprador('${c.id}')">Remover</button>
      </div>`).join('')
    : '<div class="item-empty">Nenhum comprador cadastrado ainda.</div>';
}

async function adicionarComprador(){
  const campo = document.getElementById('novoCompradorNome');
  const nome = campo.value.trim();
  if(!nome){ alert('Informe o nome do comprador.'); return; }
  const { error } = await supabaseClient.from('compradores').insert({ nome });
  if(error){ alert('Erro ao adicionar comprador: '+error.message); return; }
  campo.value = '';
  await carregarCompradores();
  renderCompradoresAdmin();
}

async function removerComprador(id){
  const c = compradoresCache.find(x=>x.id===id);
  if(!confirm(`Remover "${c ? c.nome : 'este comprador'}" da lista de compradores responsáveis?`)) return;
  const { error } = await supabaseClient.from('compradores').delete().eq('id', id);
  if(error){ alert('Erro ao remover: '+error.message); return; }
  await carregarCompradores();
  renderCompradoresAdmin();
}

// ---------------------------------------------------------------------
// 17) ATUALIZAÇÃO AUTOMÁTICA (evita precisar apertar F5)
// -----------------------------------------------------------------------
// A cada 5 segundos, se houver alguém logado, recarrega as oportunidades
// do Supabase e atualiza a tela de lista/painel que estiver aberta —
// assim, quando o gestor cadastra ou altera algo, a equipe operacional vê
// a mudança automaticamente, sem precisar recarregar a página.
// Não mexe nas telas de "Detalhe" e "Atendimento", nem quando há algum
// modal aberto, para não atrapalhar quem estiver digitando uma resposta
// ou preenchendo um campo naquele momento.
// ---------------------------------------------------------------------
setInterval(async ()=>{
  if(!currentUser || !currentScreen) return;
  const telasAtualizaveis = ['loja','lucas','gestor','estoque','clientes'];
  if(!telasAtualizaveis.includes(currentScreen)) return;
  if(document.querySelector('.modal-bg:not(.hidden)')) return;

  await carregarOportunidades();

  if(currentScreen==='loja'){
    const termo = document.querySelector('#screen-loja .search')?.value || '';
    renderLoja(termo);
  } else if(currentScreen==='lucas'){
    renderLucas();
  } else if(currentScreen==='gestor'){
    atualizarDashboardGestor();
  } else if(currentScreen==='estoque'){
    renderEstoque();
  } else if(currentScreen==='clientes'){
    renderClientes();
  }
}, 5000);
