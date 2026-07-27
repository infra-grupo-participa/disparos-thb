# Tarefa: níveis de acesso por equipe — integração de todo o sistema

Orquestrador: Opus. Implementação: Fable (backend-engineer / frontend-engineer).
Auditoria: security-pentester. Repo: sistema-disparos-participa (disparos-thb).

## Diagnóstico (Opus, 27/07/2026)

Estado atual do modelo (lib/papeis.ts + lib/auth.ts):

- 3 eixos ortogonais: `papel` (admin|disparador|operador), `equipe`
  (`principal`=Grupo Participa | `comum`) + flag `lider_equipe`, e `portais`
  (whitelist por conta, migration 0145).
- `podeVerTudo(papel, tipo)` = **só olha a equipe, ignora o papel** → QUALQUER
  membro do GP (inclusive operador) vê os cards de todas as equipes. **Furo 1.**
- `ehLiderEquipe` exige a flag `lider_equipe` E equipe comum → um `admin` de
  equipe comum SEM a flag cai em escopo de operador (vê só os cards dele).
  Não é o que o Marcio quer: admin de equipe = enxerga a equipe dele. **Furo 2.**
- `podeAcessarPortal` (0145) só é aplicado nos **layouts de página**
  (`app/[portal]/layout.tsx`, `app/hm/layout.tsx`). **Nenhuma rota de /api/**
  checa portal** → conta sem 'HM' na whitelist lê `/api/hm/kanban` direto e
  recebe o board inteiro. **Furo 3 (o mais grave).**
- Atribuição (`PATCH /api/hm/contato/[id]`): operador comum pode setar
  `responsavel_id` de **qualquer pessoa** num card do pool (a checagem só olha se
  o card tem dono/trava, não o destino). **Furo 4.**
- `setResponsavelHm` (por NOME, legado) não passa por regra nenhuma e está
  exposto no `PATCH` da ficha e no `POST /api/hm/lote`. Contorna toda a
  hierarquia de atribuição. **Furo 5.**
- Rotas HM só com `isAuthed()`, sem recorte de equipe: `/api/hm/atividade`,
  `/api/hm/agendamentos/candidatos`, `/api/hm/financeiro/export`. E
  `/api/hm/acessos` usa `papel === 'admin'` (admin de equipe comum passa).
  **Furo 6.**
- Portais genéricos (HT/SEM/CNHF): `cs.contatos` só tem `responsavel` TEXTO —
  não tem `responsavel_id` nem equipe. `/api/kanban`, `/api/contatos`,
  `/api/inbox`, `/api/dashboard/*` não recortam nada. **Furo 7.**

## Modelo-alvo (decisão do Marcio, 27/07/2026)

Três NÍVEIS efetivos, derivados de papel × equipe (não é um 4º campo no banco):

| Nível      | Quem é                                            | Vê                                   | Distribui                          |
|------------|---------------------------------------------------|--------------------------------------|------------------------------------|
| `master`   | `papel='admin'` **E** equipe `principal` (GP)     | TUDO, todas as equipes               | a qualquer um (trava o card)       |
| `gestor`   | `papel='admin'` **OU** `lider_equipe`, em qualquer equipe (que não seja master) | pool + TODOS os cards da equipe dele | só para membros da PRÓPRIA equipe  |
| `operador` | o resto                                           | pool + os cards dele                 | só assume para SI (do pool)        |

Regras derivadas:

1. **GP só vê tudo se for admin.** Operador/disparador do GP cai em `operador`;
   líder do GP cai em `gestor` com escopo da equipe GP.
2. **Admin de equipe comum vira `gestor`** (hoje cai em operador se não tiver a
   flag). A flag `lider_equipe` continua existindo e promove um operador a
   `gestor` sem lhe dar papel de admin.
3. **Exceção do pool** (o pedido explícito do Marcio): card sem responsável e
   sem equipe é visível a TODOS e qualquer `gestor` pode puxá-lo e atribuí-lo a
   um operador da própria equipe — o card então passa a pertencer à equipe dele
   (a equipe do card é derivada do dono, view `cs.contatos_hm_kanban`).
4. **Gestão de conta/acesso (`podeGerirAcesso`) = só `master`.** Contas, canais,
   tags, portais por conta, config, equipes, `/api/hm/acessos`.
5. **Portal é pré-condição de tudo**: nenhuma rota de dados responde sem o
   portal correspondente na whitelist da conta — inclusive as de /api.

## Contrato do núcleo (FIXO — backend e frontend programam contra isto)

`lib/papeis.ts` (isomórfico, sem import de servidor):

```ts
export type Papel = "admin" | "disparador" | "operador";
export type TipoEquipe = "principal" | "comum";
export type Nivel = "master" | "gestor" | "operador";

// Tudo que a regra precisa saber sobre o ator. `Usuario` (lib/auth) e `Me`
// (use-me) satisfazem esta forma — as funções passam a receber o OBJETO, não
// mais (papel, tipo) solto.
export type Ator = {
  id: string;
  papel: Papel | null | undefined;
  equipe_id: string | null;
  equipe_tipo: TipoEquipe | null;
  lider_equipe?: boolean | null;
  portais?: string[] | null;
};

export function nivelDe(u: Ator | null | undefined): Nivel;      // 'operador' se null
export function ehMaster(u): boolean;                            // nivelDe === 'master'
export function podeVerTudo(u): boolean;                         // === ehMaster
export function podeGerirAcesso(u): boolean;                     // === ehMaster
export function podeDistribuir(u): boolean;                      // master | gestor
export function escopoVisibilidade(u): EscopoVisibilidade;       // tudo | equipe | operador
export function paramsEscopo(e): { verTudo, equipeId, usuarioId };
// Pode atribuir o card para este destino? master: sempre. gestor: só se o
// destino for da mesma equipe. operador: só se destino.id === ator.id.
export function podeAtribuirPara(ator: Ator, destino: { id: string; equipe_id: string | null } | null): boolean;
// Devolver ao pool (destino null): master e gestor sempre; operador só se o
// card for dele — isso é checado na rota, com o card em mãos.
export function podeAcessarPortal(portais, evento): boolean;     // inalterado
export function podeDisparar(papel, evento): boolean;            // inalterado
```

`lib/guard.ts` (server-only, novo):

```ts
// Porta única das rotas de API. Resolve sessão, portal e nível de uma vez.
//   401 { ok:false, reason:'unauthorized' }  — sem sessão
//   403 { ok:false, reason:'sem_portal' }    — portal fora da whitelist
//   403 { ok:false, reason:'sem_permissao' } — nível insuficiente
export async function guard(opts?: {
  portal?: string | null;          // 'HM' | 'HT' | 'SEM' | 'CNHF' (resolvido pela rota)
  nivel?: "master" | "gestor";     // exige nível mínimo
}): Promise<{ ok: true; sessao: Usuario } | { ok: false; res: NextResponse }>;
```

## Etapas

- **A — backend (fable):** núcleo (`papeis.ts`, `guard.ts`, `auth.ts`) + todas as
  rotas HM + fechar furos 1,2,3,4,5,6. Sem migration.
- **B — backend (fable):** migration 0146 (`responsavel_id` em `cs.contatos` +
  trigger + equipe derivada) e recorte de equipe nos portais genéricos. Furo 7.
- **C — frontend (fable):** gating de UI pelos 3 níveis, em paralelo com A.
- **D — pentester:** auditoria adversarial do diff; loop até aprovar.

## Restrições do ambiente (importantes)

- **Sem acesso ao banco nesta máquina** (não há `.env.local`). Migrations são
  ESCRITAS mas NÃO aplicadas — o Marcio aplica. Verificação = `npm run typecheck`
  + `npm run build`.
- **Deploy é manual** no painel da Hostinger (commit na main não sobe).
- Migration 0140 tem seed de rota HT29→Equipe 2 COMENTADO. Não reativar.
- PowerShell 5.1: sem heredoc → `git commit -F arquivo`.

---

## A — Backend (fable) — 27/07/2026

**Status: entregue. `npm run typecheck` limpo (exit 0) e `npm run build` OK (exit 0).**

### Núcleo
- `lib/papeis.ts` — reescrito conforme o contrato. `nivelDe` (:55), `ehMaster`
  (:62), `podeVerTudo`/`podeGerirAcesso` = ehMaster (:69/:76), `podeDistribuir`
  (:82), `podeAtribuirPara` (:94), `escopoVisibilidade` recebe `Ator` (:121) com
  o comentário sobre gestor sem equipe (equipeId null → só pool, nunca "tudo").
  `podeDisparar`, `EVENTOS_SDR`, `podeAcessarPortal`, `ehEquipePrincipal`,
  `paramsEscopo` mantidos. `ehLiderEquipe` REMOVIDO (subsumido por nivelDe;
  nenhum call site restante).
- `lib/guard.ts` — NOVO, assinatura exata do contrato. 401 unauthorized /
  403 sem_portal / 403 sem_permissao. Nível mínimo por peso (master ≥ gestor).
- `lib/services/hm.ts:565-660` — `atribuirResponsavelHm` NOVO: a hierarquia de
  atribuição inteira (por id E por nome legado) num lugar só, usada pela ficha e
  pelo lote. Reasons: destino_fora_da_equipe, atribuicao_travada,
  sem_permissao_para_atribuir, destino_invalido, nao_encontrado.
- `lib/services/hm-atividade.ts:38-45` — `EscopoAtividade` (tudo/equipe/operador);
  recorte no SQL casando `i.autor` (texto) com os nomes de `cs.usuarios` da equipe.

### Guard aplicado (94 call sites, todas as rotas de dados)
- `app/api/hm/**` → `guard({portal:'HM'})`; portais genéricos (kanban, contatos,
  contato/[id], inbox/**, dashboard/**, disparos/**, estagios, templates/**,
  send, send-email, email/**, sync-conversas, ligacoes/**, comportamento/**,
  meu-dia, unnichat/tags) → `guard({portal: eventoDe(req)})` (Furo 3 fechado).
- Sem guard (públicas por desenho): auth, webhook, cron, eventos, hm/formularios.
  `/api/me` e `/api/portais` só sessão.
- `isAuthed()` não é mais gate de rota nenhuma (segue exportado em lib/auth).

### Furos fechados
- **F1/F2**: nivelDe — GP só vê tudo se admin; admin de equipe comum = gestor.
- **F3**: portal em toda /api (acima).
- **F4/F5**: `app/api/hm/contato/[id]/route.ts:154-174` e `app/api/hm/lote/route.ts:76-96`
  usam atribuirResponsavelHm — operador só assume p/ SI do pool / devolve o que é
  dele (sem trava); gestor só p/ membro da própria equipe (sem travar); master
  atribui a qualquer um e trava (porAdmin). Nome que não casa com usuário ativo:
  só master grava texto livre.
- **F6**: hm/acessos → master; hm/atividade → recorte por nível; hm/agendamentos/
  candidatos → predicado padrão de escopo; hm/financeiro/export e hm/kanban/export
  → recortados pelo escopo de quem exporta (verTudo/equipeId/usuarioId passados a
  relatorioFinanceiroHm/relatorioHm).
- hm/cadastrar: não-master → card nasce com o criador (responsavel = sessao.nome
  na fn + setResponsavelHmPorId(sessao.id) se card NOVO; se jaExistia, não rouba).
  `responsavel` do body é ignorado para não-master.
- Gestão → master em TODOS os métodos: hm/tags/[id], hm/equipes(/[id], /rotas),
  hm/contato/[id]/admin, hm/acessos, usuarios (POST/[id]/portais), canais/**,
  config (GET e PATCH).
- `app/api/hm/equipes/[id]/membros/route.ts` — GET NOVO (master qualquer equipe;
  gestor só a própria — seletor de atribuição); PATCH (composição) só master.

### Decisões onde o spec deixou margem
1. **GET/POST /api/hm/tags** ficaram `guard({portal:'HM'})` SEM master: o GET
   alimenta os filtros do board de todo mundo e o POST (tag livre) é gesto do
   dia a dia por comentário original; o destrutivo (renomear/recolorir/excluir,
   que propaga) é o [id], esse sim master em PATCH+DELETE.
2. **GET /api/usuarios**: payload MÍNIMO (id+nome dos ativos) p/ qualquer sessão
   — alimenta seletores de responsável no HT/HM (hm/contatos/[id]/page.tsx:97 e
   [portal]/kanban/page.tsx:186 quebrariam com master-only); payload completo
   (email/papel/portais/inativos) só master. POST/PATCH/portais = master.
3. **Trava (atribuicao_admin) × gestor**: gestor NÃO reatribui card travado
   (403 atribuicao_travada, coerente com 0142), mas DEVOLVE ao pool mesmo
   travado — o spec diz literalmente "master/gestor sempre". Se o pentester
   discordar, é 1 linha no helper.
4. **GET /api/config → master** (spec o lista nos dois grupos; prevaleceu o
   item 4). Único consumidor de GET era app/canais/page.tsx, que já é de master.
5. Operador "devolvendo" card que já está no pool → 403 sem_permissao_para_atribuir
   (leitura literal do spec; é no-op de qualquer forma).
6. `templates` PATCH (ativar/desativar) ficou só com guard de portal (era só
   isAuthed); o POST mantém podeDisparar. Spec não citou — não endureci além.

### Fora do escopo / para as próximas etapas
- Etapa B: recorte real dos portais genéricos (cs.contatos não tem responsavel_id)
  — Furo 7 continua aberto DENTRO de cada portal (todo mundo com o portal X vê
  tudo do portal X, como hoje).
- Frontend (etapa C) já ajustou use-me.ts/.tsx em paralelo — typecheck da árvore
  inteira passou limpo com os dois diffs juntos.
- `setResponsavelHm`/`setResponsavelHmPorId` seguem exportados (usados pelo
  helper e pelo webhook/serviços internos); as ROTAS só falam com
  atribuirResponsavelHm.
- Não commitei nada (working tree). Nenhuma migration criada.

## C — Frontend (fable) — 27/07/2026

Gating de UI pelos 3 níveis, programado contra o contrato (lib/papeis novo já
estava no working tree ao final). `npm run typecheck`: ZERO erros nos arquivos
de frontend; restam 9 erros, todos em `app/api/**` (rotas ainda chamando
`podeGerirAcesso(papel, tipo)` com 2 args — etapa A em voo):
canais/[id], canais (x2), canais/testar, usuarios/[id]/{portais,senha,base},
usuarios (x2). `npm run build` não rodado (falharia nesses mesmos erros).

### Arquivos tocados

- `app/_components/use-me.ts` — REESCRITO. Deriva tudo de lib/papeis passando o
  objeto `me` (satisfaz `Ator`): `nivel` (null enquanto carrega), `ehMaster()`,
  `podeVerTudo()`, `podeGerirAcesso()`, `podeDistribuir()`, `podeAtribuirPara()`,
  `podeAcessarPortal()`, `podeDisparar()`. Removida a reimplementação local de
  `ehLider` e o reexport de `ehEquipePrincipal`. Novo helper exportado
  `msgErroPermissao(reason)` traduz os 403 (`sem_portal`, `sem_permissao`,
  `destino_fora_da_equipe`, `atribuicao_travada`, `unauthorized`) em pt-BR.
- `app/_components/top-nav.tsx:15-22,46-51,64-73` — `soAdmin`/`soGP` viraram
  `soMaster`/`soGestor`; "Equipes" = gestor+ (gestor precisa VER a equipe),
  "Acessos" = só master. Filtro usa `nivel` (nasce fechado).
- `app/_components/user-menu.tsx:9-24,75-86` — passou a usar `useMe()` (uma
  única regra + um fetch a menos); "Gerenciar usuários"/"Canais de disparo" só
  master via `podeGerirAcesso()`.
- `app/hm/_components/hm-visao.tsx:16-18` — comentário: aba Equipes agora é
  gestor+ (callers passam `podeDistribuir()`).
- `app/hm/kanban/page.tsx:264-268` (nivel/podeDistribuir), `:437-441`
  (patchMover mostra `msgErroPermissao`), `:590-610` (titles dos exports
  Esteira/Financeiro .xlsx não prometem "esteira inteira" a quem não é master),
  `:775-779` (prop `ehPool`), `:1246-1249,1290-1300` (CardItem: selo
  "Pool · livre" só na visão do operador, em card sem dono/equipe/trava).
- `app/hm/tabela/page.tsx:390-395` (nivel), `:562-567` (patch → msgErroPermissao),
  `:775-820` (coluna Responsável: master/gestor = select; operador = leitura +
  botão "Assumir" só em linha do pool, via `responsavel_id`), `:1385-1405`
  (titles dos exports por nível), `:1745-1766` (select de responsável do LOTE
  só aparece para podeDistribuir).
- `app/hm/_components/hm-drawer.tsx:19-22` (Contato ganha `responsavel_id?`/
  `atribuicao_admin?` opcionais), `:296-300` (patch → msgErroPermissao),
  `:518-570` (Responsável: operador sem seletor — leitura do dono, aviso de
  trava do admin, badge "No pool — livre para assumir"; botão assumir para
  operador SÓ em pool sem trava), `:1152-1156` (AdminEdicao só `ehMaster()`).
- `app/hm/contatos/[id]/page.tsx:6,59,102-115,180-224` — ficha completa estava
  SEM gating nenhum (achado além do prompt): select de responsável era livre e
  o patch engolia erro. Agora: mesma regra do drawer + msgErroPermissao.
- `app/hm/equipes/page.tsx` — dois modos: master = gestão completa (como era);
  GESTOR = leitura da PRÓPRIA equipe (filtro client-side por `me.equipe_id`,
  defensivo — o servidor deve recortar): sem color picker, sem cargo-select
  (label estático), sem toggle de líder, sem remover, sem bloco "sem equipe",
  sem criar equipe e SEM o card de rotas (nem faz o fetch de /rotas — só master).
  Operador cai no EmptyState.
- `app/hm/acessos/page.tsx:36-40` — `papel==='admin'` → `ehMaster()` (fecha a
  brecha da Kelly ver acessos do GPS).
- `app/hm/tags/page.tsx:24-29,126` — gestão do catálogo (renomear/recolorir/
  excluir) `papel==='admin'` → `ehMaster()`; criar segue para todos.
- `app/hm/atividade/page.tsx:44-46,97` e `app/hm/reunioes/page.tsx:52-54,139`
  — podeConfig do alternador → `podeDistribuir()`.
- `app/[portal]/kanban/page.tsx:138,611` (podeDistribuir nos dois componentes),
  `:437-452` (select "Atribuir CS…" do lote só podeDistribuir), `:750-800`
  (drawer: operador sem seletor, badge "livre para assumir", botão assumir só
  sem dono). Obs.: portais genéricos seguem por NOME (`responsavel` texto) até
  a etapa B — mantive o canal legado lá.
- `app/[portal]/meu-dia/page.tsx:9,52,117-127` — toggle "Todos do portal" só
  para master; demais veem "Tudo que vejo" (o backend recorta).

### Decisões de UX

1. Skill `aiox-ux-design-expert` NÃO existe neste ambiente — segui o padrão
   Tailwind do projeto (fieldClass/fieldCompactClass, selos slate/teal/amber).
2. Operador não vê seletor desabilitado (porta trancada à vista): vê LEITURA
   (dono com avatar) e, no pool, um affordance teal tracejado "Assumir".
3. Trava do admin: badge âmbar com cadeado no lugar da ação (drawer + ficha).
4. Selo "Pool · livre" no card do board só na visão do OPERADOR — master/gestor
   distribuem, não assumem; para eles seria ruído.
5. Erros 403 nunca silenciosos: `msgErroPermissao` em board (mover), tabela
   (patch), drawer e ficha. Ex.: "Você só pode atribuir para alguém da sua
   equipe."

### Pendências / dependências do backend

- `GET /api/hm/contato/[id]` precisa devolver `responsavel_id` e
  `atribuicao_admin` no objeto `contato` (tipei como OPCIONAIS; sem eles o
  operador vê "Assumir" também em card travado — o backend barra e a UI mostra
  o motivo, mas o ideal é o campo vir).
- Listas `responsaveis` de /api/hm/kanban e /api/hm/tabela devem vir RECORTADAS
  por nível (gestor = só a própria equipe) — a UI confia nelas para o seletor.
- `GET /api/hm/equipes` deve aceitar gestor (a UI já filtra para a própria
  equipe, mas se a rota exigir master o gestor vê a tela vazia).
- Ficha completa (`/hm/contatos/[id]`) busca `/api/usuarios` para o seletor —
  se essa lista for recortada/bloqueada por nível, melhor ainda (a UI tolera
  falha).
- Lote `/api/hm/lote` por NOME (`responsavel`) continua sendo o canal do
  seletor de lote — furo 5 é do backend fechar mantendo o contrato de reasons.

## B — Backend portais genéricos (fable) — 27/07/2026

### Entregue: `db/migrations/0146_contatos_equipes_e_visibilidade.sql` (NÃO aplicada — sem banco nesta máquina; NÃO commitada)

Espelho fiel da 0140 para `cs.contatos` (HT/SEM/CNHF). Blocos:

1. `cs.contatos.responsavel_id uuid references cs.usuarios(id)` + índice
   `cs_contatos_responsavel_id_idx`.
2. Backfill texto→id em `do $backfill$`: casa por `lower(trim(nome))` só com
   usuários **ativos** e só quando o nome aponta para **exatamente um** usuário
   (ambíguo não casa — fica null). `raise notice` com casados + órfãos.
3. Trigger `trg_contatos_sync_responsavel` / `cs.fn_contatos_sync_responsavel_texto()`
   — nomes próprios, sem colidir com o par `*_hm_*` da 0140. Semântica "id
   vence" idêntica ao bloco 7 da 0140; cobre INSERT também (upserts 0133/0136
   inserem sem dono, mas se alguém inserir com dono o texto nasce coerente).
   Verificado: `cs.contatos` não tinha NENHUMA trigger antes (0001–0145).
4. `cs.contatos_ht` (view, replace com corpo da 0003 + colunas ao final) e
   `cs.contatos_evento` (replace com corpo da 0132 + colunas ao final de CADA
   braço do union): expõem `responsavel_id, equipe_id, equipe_nome, equipe_cor,
   equipe_tipo`. Equipe = `cs.usuarios.equipe_id` do dono (sem coluna nova, sem
   fallback de rota — `cs.equipe_canais` NÃO entra nos genéricos). Views são
   comuns (não materializadas); replace preserva dependentes (`vw_aluno_360`
   da 0071, 0081). NENHUM seed de roteamento canal→equipe (lição da 0144).
5. POOL = `responsavel_id is null and equipe_id is null` (idêntico ao HM).
6. Bloco final comentado: 6 queries de verificação p/ o Marcio (panorama por
   evento, nomes órfãos, nomes ambíguos, distribuição por equipe, pool,
   sanidade id↔texto).

Predicado de visibilidade (documentado no cabeçalho da migration):
`verTudo OR (responsavel_id is null and equipe_id is null) OR equipe_id = $minhaEquipe OR responsavel_id = $eu`
— colunas vêm de `cs.contatos_evento` (ou `cs.contatos_ht`).

### Riscos do backfill
- `cs.contatos.responsavel` é texto LIVRE: apelidos/typos ("Jusy" vs "Jusy
  Machado") não casam → ficam `responsavel_id null` com texto órfão. Órfão NÃO
  entra no pool das rotas novas (fica visível só a master) — rodar query (b)
  da verificação e reatribuir por id na UI.
- Usuário inativo com cards não casa (por design). Reatribuir manualmente.
- Fluxos que continuarem escrevendo SÓ o texto (`setResponsavel` por nome)
  divergem do id (query (f) detecta). Precisa da etapa de rotas abaixo.

### ROTAS `.ts` que precisam do recorte (próximo agente — NÃO editei .ts)

Recorte de leitura = predicado acima com `paramsEscopo` (verTudo/equipeId/usuarioId),
sempre atrás de `guard({ portal })`:

| Rota | O que aplicar |
|---|---|
| `app/api/kanban/route.ts` | predicado nos cards e nas CONTAGENS por estágio; filtro `responsavel` (query param, por nome) → por `responsavel_id`; lista `responsaveis` (linha 85) restrita à equipe p/ gestor |
| `app/api/contatos/route.ts` | predicado sobre `v` (contatos_evento) |
| `app/api/contato/[id]/route.ts` | GET: 404/403 fora do escopo; PATCH linha 117 usa `setResponsavel` por NOME = furo 5 dos genéricos → trocar por id + `podeAtribuirPara` |
| `app/api/kanban/lote/route.ts` | idem: linha 21 `setResponsavel` por nome em lote → id + `podeAtribuirPara` por destino |
| `app/api/kanban/pegar-leads/route.ts` | pool: trocar `ct.responsavel is null or =''` (linha 29) por `ct.responsavel_id is null and equipe derivada null`; auto-atribuição grava `responsavel_id` do ator (texto deriva da trigger) |
| `app/api/meu-dia/route.ts` | linhas 54/70/90 filtram `c.responsavel = $nome` → `c.responsavel_id = $eu` |
| `app/api/inbox/route.ts`, `inbox/metricas/route.ts`, `inbox/[id]/route.ts` | predicado no join com contatos_evento (listas, contadores e ficha) |
| `app/api/comportamento/route.ts`, `comportamento/perfil/route.ts` | predicado sobre contatos_evento (leitura analítica por contato) |
| `app/api/disparos/elegiveis/route.ts` | JÁ referencia `v.responsavel_id`/`v.equipe_id` (linhas 63-64 — agente A/rotas já codou contra a view da 0146); só conferir alinhamento do predicado |
| `app/api/send/route.ts`, `app/api/send-email/route.ts` | destinatários saem de contatos_evento — aplicar o MESMO predicado dos elegíveis para operador/gestor não dispararem para cards fora do escopo |
| `app/api/dashboard/executivo|jornada|canais/route.ts` | DECISÃO DE PRODUTO: dashboards agregados — gestor vê só a equipe? Orquestrador decide com o Marcio antes de recortar |
| `lib/services/contato.ts:58` (`setResponsavel`) | criar `setResponsavelPorId` (espelho do `setResponsavelHmPorId` de `lib/services/hm.ts:529`) e migrar os 2 call-sites; o legado por nome deixa id/texto divergirem |
| `db/schema.ts:21` (drizzle `contatos`) | adicionar `responsavelId: uuid("responsavel_id")` p/ o schema não mentir |

### B2 — Rotas dos portais genéricos + dashboards + acertos p/ o front (fable, 27/07/2026)

**Status: entregue. `npm run typecheck` limpo (exit 0), `npm run build` "Compiled
successfully" (exit 0). Nada commitado.**

#### Núcleo genérico (lib/services/contato.ts)
- `sqlEscopo(cols, params)` — fragmento SQL único do predicado (typo-proof nas
  14 queries que o usam). **POOL nos genéricos = id null E equipe null E texto
  vazio**: card com texto órfão NÃO é pool (era o card de alguém no mundo
  antigo; soltá-lo vazaria o lead p/ qualquer equipe) — fica só com master, como
  a 0146 documenta. DIVERGÊNCIA deliberada do predicado literal do spec (que não
  checa o texto); no HM segue sem checagem de texto (0140 não tem esse risco
  documentado).
- `podeVerContato(sessao, compradorId, evento)` — análogo do podeVerCardHm,
  sobre cs.contatos_evento; chamado em TODA rota unitária.
- `setResponsavelPorId(ids, evento, responsavelId, autor)` — grava o id (texto
  deriva da trigger 0146); pool limpa id E texto; timeline por card. Escopado
  por EVENTO (o legado setResponsavel atualizava o comprador em TODOS os
  eventos — corrigido no caminho novo).
- `atribuirResponsavel(sessao, compradorId, destino, evento, autor)` — espelho
  de atribuirResponsavelHm, MESMOS reasons. Sem trava (atribuicao_admin não
  existe em cs.contatos): `atribuicao_travada` = operador mexendo em card com
  outro dono (id OU texto órfão). Texto livre só master, com clear do id em
  update separado ANTES do texto (num único UPDATE a trigger sobrescreveria o
  texto com null). Tipos reexportados de hm.ts (contrato único).
- `db/schema.ts:29` — `responsavelId` no drizzle de cs.contatos.

#### Furo 7 — recorte aplicado (leitura + escrita)
- `api/kanban` GET (colunas via join usuarios, cards via view, lista
  `responsaveis` por nível: master=ativos+legados, gestor=própria equipe,
  operador=ele); PATCH ganhou podeVerContato (403 sem_acesso).
- `api/kanban/lote` — recorte em 1 query (ids fora do escopo → `falhas`
  nominais); responsável por NOME via atribuirResponsavel, card a card.
- `api/kanban/pegar-leads` — pool de verdade (id null + equipe null + texto
  vazio; antes era só texto vazio = roubava card com id sem texto) e
  auto-atribuição por ID. Corrida select→update entre 2 SDRs simultâneos segue
  possível (pré-existente; último vence, timeline registra os dois).
- `api/contatos` — predicado sobre v.
- `api/contato/[id]` — GET/PATCH com podeVerContato; GET agora devolve
  `responsavel_id, equipe_id, equipe_nome`; PATCH: responsável via
  atribuirResponsavel (403/400/404 pelos reasons).
- `api/inbox` (fila, modo-disparo E contador `pendentes`), `api/inbox/[id]`
  (GET/POST/PATCH com podeVerContato) — conversa fora do escopo não abre, não
  responde, não resolve.
- `api/meu-dia` — `meus=1` por `responsavel_id` (não mais nome-texto); sem
  `meus`, o escopo padrão (master=portal; resto=o que vê).
- `api/comportamento` (ciclo/engajamento/funil/msgs; funil recorta no COUNT
  p/ a etapa zerada não sumir) e `api/comportamento/perfil`.
- `api/send` (ramo genérico E ramo HM — o HM não tinha recorte nenhum ali) e
  `api/send-email` — destinatário fora do escopo fica fora do insert.
- `api/ligacoes` GET+POST (podeVerContato) e `api/ligacoes/metricas`.
- `api/disparos/elegiveis` — o ramo GENÉRICO não tinha o predicado (só o HM);
  alinhado.

#### Dashboards (decisão do Marcio) — recortados
- executivo (funil/KPIs/cobertura/ritmo via CTE `pessoas`), jornada, campeões
  WhatsApp (via dc.comprador_id→v), canais WhatsApp+ligações, inbox/metricas
  (inclui pendentes/maior espera), email/metricas bloco `nossos`.

#### Métricas que FICARAM GLOBAIS (não recortáveis — comentadas nas rotas)
1. `email/metricas` kpis+campanhas e `dashboard/canais`/`dashboard/campeoes`
   bloco e-mail: cs.campanhas_email é agregado POR CAMPANHA do ActiveCampaign,
   sem vínculo campanha→contato.
2. `ligacoes/metricas` `sem_vinculo`: comprador_id null — sem dono possível.
3. `comportamento` bloco `sync`: frescura da sincronização Unnichat (infra).
4. `api/dashboard` (raiz, painel de disparos): fora da lista do Marcio — segue
   global (métrica de campanha/canal). Sinalizar ao orquestrador se quiser
   incluir.

#### Trabalho 3 — contrato com o front
1. `lib/services/hm-ficha.ts` — ficha devolve `responsavel_id, equipe_id,
   equipe_nome, equipe_cor` (view 0140) + `atribuicao_admin` (join contatos_hm;
   a view do kanban não a expõe).
2. `api/hm/kanban` e `api/hm/tabela` — `responsaveis` recortada por nível
   (master=todos+legados; gestor=membros ativos da própria equipe;
   operador=[ele]).
3. `api/hm/equipes` GET — `nivel:'gestor'`; gestor recebe SÓ a equipe dele e os
   usuários dela (recorte no SQL, não na UI); master segue completo; POST/
   PATCH/DELETE/rotas continuam master.

## D — Pentester

<pendente>
