"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Card, PageHeader, cn, fieldClass } from "@/app/_components/ui";
import { useMe } from "@/app/_components/use-me";
import { usePortal } from "@/app/_components/use-portal";

// Central de Ajuda — conteúdo estático, escrito para o OPERADOR (não para dev).
// Regra de ouro do texto: nada aqui descreve um comportamento que não exista na
// tela. As mensagens de erro citadas são as REAIS (msgErroPermissao em use-me.ts
// e os `reason` das rotas) — se uma rota mudar de mensagem, atualize aqui junto.
//
// A mesma página atende todos os portais: /ht/ajuda, /seminario/ajuda,
// /curso/ajuda e /hm/ajuda. O que é específico do Holding Masters está sempre
// marcado com o selo "Holding Masters".

// ---------- peças visuais que IMITAM os selos reais do sistema --------------
// (mesmas classes dos componentes de verdade — o operador reconhece na hora)

function SeloPool() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded border border-dashed border-teal-400 px-1.5 py-0.5 text-[10px] font-semibold text-teal-700 dark:border-teal-500/50 dark:text-teal-300">
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></svg>
      Pool · livre
    </span>
  );
}
function SeloCancelado() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
      <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
      só admin GP
    </span>
  );
}
function SeloHM() {
  return (
    <span className="mr-1.5 inline-flex items-center rounded bg-amber-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
      Holding Masters
    </span>
  );
}

// Mensagem de erro REAL do sistema, como o operador a vê.
function Msg({ children }: { children: ReactNode }) {
  return (
    <p className="my-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
      “{children}”
    </p>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 font-sans text-[11px] font-semibold text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </kbd>
  );
}

// Parágrafo e lista padrão do corpo — um lugar só para o tom da tipografia.
function P({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{children}</p>;
}
function Li({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
      <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand/60 dark:bg-brand-400/60" aria-hidden />
      <span>{children}</span>
    </li>
  );
}
function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-slate-800 dark:text-slate-100">{children}</strong>;
}

// ---------- conteúdo ---------------------------------------------------------

type Secao = { id: string; titulo: string; busca: string; corpo: ReactNode };
type Pergunta = { q: string; busca: string; a: ReactNode };

// As mesmas strings de msgErroPermissao (use-me.ts) — citadas literalmente.
const MSG = {
  sem_portal: "Sua conta não tem acesso a este portal. Peça a liberação a um administrador do Grupo Participa.",
  sem_permissao: "Você não tem permissão para esta ação.",
  destino_fora_da_equipe: "Você só pode atribuir para alguém da sua equipe.",
  // Texto atualizado no P6 (12/08) — espelha use-me.ts: o mesmo reason cobre
  // "admin travou" (0142) e "card de outra equipe na esteira compartilhada",
  // que antes tinha uma mensagem críptica para o segundo caso.
  atribuicao_travada: "Não é possível assumir este card para você — ele é de outra equipe (ou a atribuição foi travada pelo administrador). Você pode movê-lo e editá-lo normalmente; só a reatribuição para si é que fica bloqueada. Fale com o administrador do Grupo Participa se precisar mudar o dono.",
  cancelamento_so_admin_gp: "Card em Reclamada/Reembolsado — só o administrador do Grupo Participa altera cards cancelados.",
  card_de_outro_operador: "Este card é de outro operador da sua equipe — você pode ver a ficha e o histórico, mas não alterar. Fale com seu gestor para redistribuir.",
  unauthorized: "Sua sessão expirou — entre de novo.",
  // COLUNAS IMUTÁVEIS DA HOTMART (17/08, pedido do Marcio): as strings abaixo
  // são MODELO — a mensagem real que o board mostra inclui o nome da etapa e a
  // direção (entrada/saída) que a API devolveu em `coluna`/`direcao`; aqui é
  // fixado só o texto-base, para a Central de Ajuda citar literalmente.
  coluna_da_hotmart_saida: "\"Boleto Gerado\" vem da Hotmart. A ficha entra e sai desta coluna sozinha, quando o pagamento é confirmado. Se a pessoa já pagou e não andou, avise o administrador — não mova à mão.",
  coluna_da_hotmart_espelho: "\"Pagamento Realizado\" é um espelho. Esta pessoa está na Ativação; o Comercial só a mostra. Para tirá-la da Ativação, abra a ficha.",
};

const PERGUNTAS: Pergunta[] = [
  {
    q: "O card do colega abre, mas está tudo travado. É defeito?",
    busca: "card colega leitura travado nao edita outro operador visibilidade fulano com",
    a: (
      <>
        <P>
          Não é defeito — é o desenho. Como <B>operador</B>, você enxerga o pool <B>e todos os cards da sua
          equipe</B>, inclusive os dos colegas: dá para abrir a ficha, ler a timeline e acompanhar o que cada um
          fez. Mas <B>agir</B> (mover etapa, editar campos, disparar) só no que é <B>seu</B> ou está no{" "}
          <B>pool</B>. Se você tentar mesmo assim, verá:
        </P>
        <Msg>{MSG.card_de_outro_operador}</Msg>
        <P>
          O card do colega vem marcado com o nome do dono (ex.: “com Ana”). Se aquele lead precisa passar para
          você, é o gestor quem redistribui.
        </P>
      </>
    ),
  },
  {
    q: "Tentei atribuir um card para alguém e deu erro. Por quê?",
    busca: "atribuir responsavel outra equipe erro destino fora da equipe",
    a: (
      <>
        <Msg>{MSG.destino_fora_da_equipe}</Msg>
        <P>
          O gestor distribui cards <B>apenas entre pessoas da própria equipe</B>. Só o administrador do
          Grupo Participa atribui para qualquer pessoa. Se o card precisa mudar de equipe, peça ao
          administrador do GP.
        </P>
      </>
    ),
  },
  {
    q: "O card está com uma trava e não consigo mudar o operador.",
    busca: "trava travado cadeado ambar atribuicao travada admin",
    a: (
      <>
        <Msg>{MSG.atribuicao_travada}</Msg>
        <P>
          Quando o administrador do Grupo Participa atribui um card, ele pode <B>travar</B> essa atribuição
          (a ficha mostra um aviso âmbar com cadeado). A partir daí, nem gestor troca o operador — a
          alteração é só com o administrador do GP.
        </P>
        <P>
          O mesmo aviso aparece na <B>Ativação do HM</B> quando você tenta <B>assumir</B> um card de outra
          equipe (ex.: um card da Equipe 2 aparecendo para o Grupo Participa). Ali você pode mover e editar
          normalmente — só assumir para si é que fica bloqueado, de propósito.
        </P>
      </>
    ),
  },
  {
    q: "Cliquei num card e ele não abre (cadeado vermelho).",
    busca: "card nao abre cadeado vermelho cancelado reclamada reembolsado bloqueado hm",
    a: (
      <>
        <P>
          <SeloHM />Card nas colunas <B>Reclamada</B> ou <B>Reembolsado</B> fica com o selo <SeloCancelado /> e
          não abre para quem não é administrador do Grupo Participa — cancelamento é assunto do GP.
          Se você tentar por um link direto, verá:
        </P>
        <Msg>{MSG.cancelamento_so_admin_gp}</Msg>
        <P>Não é defeito: o card continua visível no board para você saber que aquele aluno está em cancelamento.</P>
      </>
    ),
  },
  {
    q: "“Sua conta não tem acesso a este portal.” E agora?",
    busca: "sem portal acesso liberacao whitelist entrar",
    a: (
      <>
        <Msg>{MSG.sem_portal}</Msg>
        <P>
          Cada conta é liberada por portal (HT, Seminário, Curso de Holding, Holding Masters). Se o seu
          trabalho passou a incluir um portal que você não acessa, peça a liberação a um administrador do
          Grupo Participa.
        </P>
      </>
    ),
  },
  {
    q: "“Você não tem permissão para esta ação.”",
    busca: "sem permissao acao negada 403",
    a: (
      <>
        <Msg>{MSG.sem_permissao}</Msg>
        <P>
          A ação que você tentou é de um nível acima do seu — por exemplo, gerir equipes, acessos ou canais
          (só administrador do GP). Se você acha que deveria ter esse direito, fale com seu gestor.
        </P>
      </>
    ),
  },
  {
    q: "Apareceu “Sua sessão expirou”.",
    busca: "sessao expirou login sair entrar de novo",
    a: (
      <>
        <Msg>{MSG.unauthorized}</Msg>
        <P>Entre de novo pela tela de login. O que você havia salvo continua salvo; só a sessão venceu.</P>
      </>
    ),
  },
  {
    q: "Não consigo escrever para o lead no Inbox — pede um template.",
    busca: "inbox janela 24h fechada template abertura whatsapp escrever",
    a: (
      <>
        <P>
          O WhatsApp só permite texto livre dentro da <B>janela de 24 horas</B> após a última mensagem do
          lead. Se a janela fechou (ou o lead nunca escreveu), o sistema mostra o aviso
          “Janela de conversa fechada” e a única saída é enviar um <B>template pronto</B>. Escolha um na
          lista e envie: quando o lead responder, a conversa reabre e você escreve livremente.
        </P>
      </>
    ),
  },
  {
    q: "Movi um card para a Ativação e ele voltou.",
    busca: "hm ativacao voltou saldo em aberto sinal pagamento checklist incompleto",
    a: (
      <>
        <P>
          <SeloHM />Duas travas podem devolver o card, e o aviso diz qual foi:
        </P>
        <ul className="mt-2 space-y-1.5">
          <Li><B>Saldo em aberto</B> — o sinal não é pagamento realizado. Só entra na Ativação quem quitou o saldo; registre o pagamento na ficha antes.</Li>
          <Li><B>Checklist incompleto</B> — “Ativação Realizada” exige os itens do checklist marcados na ficha do card.</Li>
        </ul>
      </>
    ),
  },
  {
    q: "Arrastei um card sem querer. Dá para desfazer?",
    busca: "desfazer movimento arrastei errado voltar etapa",
    a: (
      <>
        <P>
          <SeloHM />Sim: botão direito no card → <B>Desfazer último movimento</B>. Nos demais portais não há
          desfazer — arraste o card de volta para a coluna certa (ou corrija a etapa pelo painel do card).
        </P>
      </>
    ),
  },
  {
    q: "Tentei mover “Boleto Gerado” (ou outra coluna com cadeado) e não consegui.",
    busca: "boleto gerado reembolsado reclamada compra aprovada imutavel cadeado hotmart nao arrasta trava coluna",
    a: (
      <>
        <P>
          <SeloHM />Cinco etapas do Comercial são <B>automáticas</B>: Boleto Gerado, Reclamada e Reembolsado
          (e o par que a Ativação alimenta) só andam quando a Hotmart confirma o pagamento ou o cancelamento —
          ninguém arrasta a ficha para dentro nem para fora delas à mão. O cabeçalho da coluna já mostra o
          cadeado. Se você tentar mesmo assim, verá:
        </P>
        <Msg>{MSG.coluna_da_hotmart_saida}</Msg>
        <P>
          “Pagamento Realizado” e “Pagamento Parcelado” são <B>espelho</B> da Ativação — mostram quem já pagou,
          mas a ficha de verdade mora lá. Tentar arrastá-las mostra:
        </P>
        <Msg>{MSG.coluna_da_hotmart_espelho}</Msg>
        <P>
          Só o administrador do Grupo Participa pode forçar esse movimento, quando é mesmo preciso corrigir algo
          que a Hotmart não refletiu.
        </P>
      </>
    ),
  },
  {
    q: "Cliquei em “Pegar próximos 20” e não veio nada.",
    busca: "pegar proximos leads nenhum lead sem dono disponivel meu dia",
    a: (
      <>
        <P>
          O botão puxa para você os leads <B>sem dono</B> (do pool). Se aparecer “Nenhum lead sem dono
          disponível agora”, é porque o pool do portal está vazio — todos os leads já têm dono.
          Fale com seu gestor se a sua carteira está vazia.
        </P>
      </>
    ),
  },
];

// ---------- página -----------------------------------------------------------

const NIVEL_LABEL: Record<string, { rotulo: string; resumo: string }> = {
  master: { rotulo: "Administrador do Grupo Participa", resumo: "você vê todos os cards, de todas as equipes, e pode atribuir para qualquer pessoa." },
  gestor: { rotulo: "Gestor de equipe", resumo: "você vê o pool + todos os cards da sua equipe, e distribui entre as pessoas dela." },
  operador: { rotulo: "Operador", resumo: "você vê o pool + os cards da sua equipe; age no que é seu ou está livre (o card do colega abre em leitura)." },
};

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export default function CentralAjuda() {
  const { me, nivel } = useMe();
  const { ehHM, nome } = usePortal();
  const [q, setQ] = useState("");
  const nq = norm(q.trim());

  // Seções construídas uma vez — a busca filtra por título + palavras-chave.
  const secoes = useMemo<Secao[]>(() => [
    {
      id: "comecando",
      titulo: "Começando: portais e navegação",
      busca: "portal portais trocar login senha sair menu busca ctrl k holding total seminario hm masters aurum ethb",
      corpo: (
        <>
          <P>
            O sistema é dividido em <B>portais</B>, um para cada evento: <B>Holding Total (HT)</B>,{" "}
            <B>Seminário</B>, <B>Holding Masters (HM)</B>, <B>Aurum</B> e <B>ETHB</B>. Cada portal é um
            espaço separado, com seus próprios contatos e telas — você está agora no portal <B>{nome}</B>.
          </P>
          <ul className="mt-3 space-y-1.5">
            <Li><B>Trocar de portal:</B> clique no botão com a bolinha colorida, ao lado da logo no topo. Ele leva à tela de seleção. Você só entra nos portais liberados para a sua conta.</Li>
            <Li><B>Menu principal:</B> Meu dia, Jornada (o Kanban), Leads, Inbox, Disparos, Dashboard, Atividade e Templates. No HM o menu é outro: Jornada, Agendamentos, Inbox, Disparos e Templates (Equipes e Acessos aparecem só para gestor/administrador).</Li>
            <Li><B>Buscar um lead:</B> use a busca no topo (ou <Kbd>Ctrl</Kbd> + <Kbd>K</Kbd>). Digite nome, e-mail ou telefone e abra a ficha direto.</Li>
            <Li><B>Sua conta:</B> clique no seu nome no canto direito para trocar a senha ou sair.</Li>
          </ul>
        </>
      ),
    },
    {
      id: "niveis",
      titulo: "Níveis de acesso: quem vê o quê",
      busca: "nivel acesso master gestor operador equipe pool ver tudo visibilidade card colega distribuir assumir",
      corpo: (
        <>
          {me && nivel && (
            <div className="mb-4 rounded-lg border border-brand/25 bg-brand/5 px-3 py-2.5 text-sm text-slate-700 dark:border-brand-400/25 dark:bg-brand-400/10 dark:text-slate-200">
              Você está como <B>{NIVEL_LABEL[nivel].rotulo}</B>
              {me.equipe_nome ? <> · equipe <B>{me.equipe_nome}</B></> : null} — {NIVEL_LABEL[nivel].resumo}
            </div>
          )}
          <P>
            O que cada pessoa enxerga <B>não é o mesmo</B> — e isso é proposital: cada um trabalha a própria
            carteira, o gestor acompanha a equipe, e o Grupo Participa vê o todo.
          </P>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[520px] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-400 dark:border-slate-700 dark:text-slate-500">
                  <th className="py-2 pr-3">Nível</th>
                  <th className="py-2 pr-3">Vê</th>
                  <th className="py-2">Atribui cards</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600 dark:divide-slate-800 dark:text-slate-300">
                <tr>
                  <td className="py-2.5 pr-3 font-semibold text-slate-800 dark:text-slate-100">Operador</td>
                  <td className="py-2.5 pr-3">O pool + todos os cards da equipe dele (os dos colegas, em leitura)</td>
                  <td className="py-2.5">Só assume para si um card do pool; age só no que é dele</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-semibold text-slate-800 dark:text-slate-100">Gestor</td>
                  <td className="py-2.5 pr-3">O pool + todos os cards da equipe dele</td>
                  <td className="py-2.5">Para qualquer pessoa da própria equipe</td>
                </tr>
                <tr>
                  <td className="py-2.5 pr-3 font-semibold text-slate-800 dark:text-slate-100">Administrador GP</td>
                  <td className="py-2.5 pr-3">Tudo, de todas as equipes</td>
                  <td className="py-2.5">Para qualquer pessoa (e pode travar a atribuição)</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-4 rounded-lg border border-teal-200 bg-teal-50/60 p-3 dark:border-teal-500/25 dark:bg-teal-500/10">
            <p className="text-sm font-semibold text-teal-800 dark:text-teal-200">A regra do pool</p>
            <p className="mt-1 text-sm leading-relaxed text-teal-800/90 dark:text-teal-100/80">
              Card <B>sem operador e sem equipe</B> está no <B>pool</B>: todo mundo o vê, e qualquer
              operador pode assumi-lo. Assim que alguém vira o dono, o card passa a pertencer àquela pessoa
              (e à equipe dela): os <B>colegas da mesma equipe continuam vendo</B> — em leitura, com o nome
              do dono no card — e as <B>outras equipes deixam de ver</B>. Quem age no card é só o dono
              (ou o gestor, redistribuindo).
            </p>
          </div>
          {ehHM && (
            <ul className="mt-3 space-y-1.5">
              <Li>No board do HM, a <B>borda esquerda colorida</B> do card é a cor da equipe dona. Borda <B>tracejada cinza</B> = card do pool, sem dono.</Li>
              <Li>Na visão do operador, o card livre também ganha o selo <SeloPool /> — abra a ficha e clique em “Atribuir a mim”.</Li>
            </ul>
          )}
        </>
      ),
    },
    {
      id: "kanban",
      titulo: "Trabalhar o Kanban (Jornada)",
      busca: "kanban jornada coluna etapa arrastar mover card abrir detalhe filtro selecao multipla botao direito tempo etapa drawer ficha",
      corpo: (
        <>
          <P>
            O Kanban é a esteira do portal: cada <B>coluna é uma etapa</B> da jornada e cada <B>card é um
            lead</B>. Seu trabalho é fazer o card andar para a direita.
          </P>
          <ul className="mt-3 space-y-1.5">
            <Li><B>Mover de etapa:</B> arraste o card até a coluna de destino e solte. A mudança grava na hora e fica registrada no histórico do contato.</Li>
            <Li><B>Abrir o card:</B> clique nele. Abre o painel lateral com resumo, formulários respondidos e histórico — e o botão “Ficha completa”. Também dá para mudar a etapa por ali, pelo seletor “Etapa da jornada”.</Li>
            <Li><B>Botão direito no card:</B> menu rápido — selecionar, selecionar a coluna inteira, disparar, abrir detalhes.{ehHM ? " No HM o menu também move o card para qualquer etapa (das duas esteiras), desfaz o último movimento e adiciona sócio." : ""}</Li>
            <Li><B>Rolar o board:</B> a roda do mouse rola as colunas na horizontal; dentro de uma coluna cheia, rola os cards primeiro.</Li>
            <Li><B>Tempo na etapa:</B> o relógio no rodapé do card esquenta com a idade — âmbar aos 3 dias, vermelho aos 7. Card vermelho é lead esfriando.</Li>
            <Li><B>Filtros:</B> no topo do board — por edição, operador e tag. Bom para ver só a sua carteira ou só um grupo.</Li>
            <Li><B>Seleção múltipla:</B> passe o mouse no card e marque a bolinha no canto (ou selecione a coluna inteira pelo cabeçalho). A barra que aparece embaixo aplica tag, atribui operador (gestor/administrador) e dispara em lote. Card de colega não entra na seleção — nele você só lê.</Li>
            <Li><B>Ações rápidas no card:</B> ao passar o mouse, aparecem os atalhos WhatsApp, ligar, e-mail e “Conversar no inbox”.</Li>
          </ul>
          {ehHM && (
            <>
              <p className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-100"><SeloHM />O board do HM tem regras próprias</p>
              <ul className="mt-2 space-y-1.5">
                <Li><B>Duas esteiras:</B> abas <B>Comercial</B> e <B>Ativação</B>. Quem quitou o saldo mora na Ativação, mas continua visível no Comercial (parado em “Pagamento Realizado” ou “Pagamento Parcelado”) — é o mesmo card, mostrado nos dois lugares.</Li>
                <Li><B>Ordenar a fila:</B> além de trocar de coluna, arrastar para cima/baixo reordena os cards dentro da coluna.</Li>
                <Li><B>Entrar na Ativação = declarar pagamento:</B> o sistema confirma antes, porque isso marca o saldo como pago e cria o aluno na base.</Li>
                <Li><B>Reclamada</B> é o pedido de cancelamento; <B>Reembolsado</B> é o reembolso executado. Card nessas colunas fica com o selo <SeloCancelado /> e só o administrador do GP abre e edita.</Li>
                <Li><B>Errou o arrasto?</B> Botão direito → “Desfazer último movimento”.</Li>
              </ul>
            </>
          )}
        </>
      ),
    },
    {
      id: "assumir",
      titulo: "Pool: assumir um lead para você",
      busca: "assumir lead pool pegar proximos atribuir a mim sem responsavel livre carteira",
      corpo: (
        <>
          <P>Três jeitos de encher a sua carteira com cards livres:</P>
          <ul className="mt-3 space-y-1.5">
            <Li><B>Em lote, no Meu dia:</B> clique em <B>“Pegar próximos 20 para mim”</B>. O sistema atribui a você os leads sem dono e a sua fila já reabastece.</Li>
            <Li><B>Um a um, pelo card:</B> abra o card; se ele estiver <B>sem operador</B>, aparece o botão <B>“Atribuir a mim”</B> (no HM, “Assumir”). Clique e o lead é seu.</Li>
            <Li><B>Pelo gestor:</B> quem é gestor ou administrador distribui cards pela ficha, pelo painel do card ou pela seleção em lote no board.</Li>
          </ul>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/60 p-3 text-sm leading-relaxed text-slate-600 dark:border-slate-700 dark:bg-slate-800/40 dark:text-slate-300">
            <B>Importante:</B> operador não “rouba” card — se o lead já tem dono, o botão de assumir não
            aparece (o card do colega abre em leitura). Card com dono só muda de mão pelo gestor (dentro da
            equipe) ou pelo administrador do GP.
          </div>
        </>
      ),
    },
    {
      id: "registrar",
      titulo: "Registrar ligações, WhatsApp e atendimentos",
      busca: "registrar atendimento ligacao tentativa whatsapp presencial resultado duracao retorno anotacao atalho teclado historico timeline",
      corpo: (
        <>
          <P>
            <B>Toque não registrado é toque que não existiu</B> — o placar e as filas do Meu dia são
            alimentados pelo que você registra. O registro abre em dois lugares:
          </P>
          <ul className="mt-3 space-y-1.5">
            <Li>No <B>Meu dia</B>, botão <B>“Registrar”</B> ao lado de cada nome da fila.</Li>
            <Li>Na <B>ficha do lead</B>, cartão <B>“Atendimentos”</B> → botão “Registrar”.</Li>
          </ul>
          <p className="mt-4 text-sm font-semibold text-slate-800 dark:text-slate-100">Como preencher (leva segundos)</p>
          <ul className="mt-2 space-y-1.5">
            <Li><B>Canal:</B> Ligação, WhatsApp ou Presencial. O modal já traz o botão “Discar” / “Abrir conversa” — você liga e registra sem trocar de tela.</Li>
            <Li><B>Resultado:</B> Atendeu (ou “Respondeu”, no WhatsApp), Não atendeu, Caixa postal, Ocupado, Número errado. As teclas <Kbd>1</Kbd> a <Kbd>5</Kbd> escolhem direto.</Li>
            <Li><B>Duração</B> em minutos e uma <B>anotação</B> curta (como foi, próximo passo).</Li>
            <Li><B>Agendar retorno:</B> marque data e hora — o compromisso aparece na fila <B>“Você prometeu retornar”</B> do seu Meu dia quando vencer.</Li>
            <Li>Atalhos: <Kbd>Enter</Kbd> salva, <Kbd>Esc</Kbd> fecha (na anotação, <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> salva).</Li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            <B>Onde isso aparece depois:</B> na lista “Atendimentos” da ficha do lead e no seu placar do
            Meu dia. A aba <B>Histórico</B> do card mostra a linha do tempo completa do lead — disparos
            enviados, respostas, notas e mudanças de etapa.
          </p>
        </>
      ),
    },
    {
      id: "inbox",
      titulo: "Inbox: responder o lead",
      busca: "inbox conversa responder whatsapp janela 24h template abertura resolver reabrir pendente respostas rapidas atalho bip",
      corpo: (
        <>
          <P>
            O Inbox é a fila de conversas de WhatsApp do portal. A lista da esquerda tem três abas:{" "}
            <B>Pendentes</B> (leads esperando resposta — comece por aqui), <B>Todas</B> e <B>Resolvidas</B>.
            A fila é “ao vivo”: atualiza sozinha a cada poucos segundos, o título da aba do navegador conta
            os pendentes e um bip toca quando chega resposta nova.
          </P>
          <ul className="mt-3 space-y-1.5">
            <Li><B>Abrir e responder:</B> clique na conversa, leia o histórico (as bolhas marcadas “Template” foram disparos; “Equipe” foi alguém do time escrevendo) e responda no campo de baixo. <Kbd>Enter</Kbd> envia.</Li>
            <Li><B>Janela de 24h:</B> texto livre só vale até 24h após a última mensagem do lead. A faixa verde no rodapé mostra até quando a janela está aberta. Fechou? O sistema pede um <B>template de abertura</B> — envie um e, quando o lead responder, a conversa reabre.</Li>
            <Li><B>Resolver:</B> responder já marca a conversa como resolvida. Dá também para usar os botões “Resolver” / “Reabrir” no topo da conversa.</Li>
            <Li><B>Respostas rápidas:</B> os atalhos acima do campo de texto colam frases prontas. Crie os seus no “+ atalho”.</Li>
            <Li><B>“Atendendo como”:</B> preencha seu nome no topo — é ele que aparece nas métricas de atendimento (botão “Desempenho”).</Li>
            <Li><B>Vindo do Kanban:</B> o ícone de balão no card abre o Inbox já na conversa daquele contato.</Li>
          </ul>
        </>
      ),
    },
    {
      id: "meu-dia",
      titulo: "Meu dia: por onde começar o expediente",
      busca: "meu dia fila retorno esperando resposta sem toque placar atendimentos hoje pegar leads",
      corpo: (
        <>
          <P>
            O Meu dia responde três perguntas, nesta ordem: <B>quem eu prometi retornar?</B>{" "}
            <B>quem está esperando resposta?</B> <B>quem ninguém toca há dias?</B> Trabalhe as filas de cima
            para baixo:
          </P>
          <ul className="mt-3 space-y-1.5">
            <Li><B>Você prometeu retornar</B> (vermelho): retornos que você agendou e já venceram. É dívida — comece por aqui.</Li>
            <Li><B>Esperando resposta</B> (âmbar): leads que escreveram e ninguém respondeu.</Li>
            <Li><B>Sem toque</B> (cinza): estão no funil e ninguém fala com eles há dias. É onde o lead esfria.</Li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            No topo, o <B>placar do seu dia</B>: atendimentos registrados, conversas de verdade, tempo falado
            e retornos agendados. O seletor <B>“Meus leads”</B> foca a fila na sua carteira;{" "}
            <B>“Tudo que vejo”</B> abre para tudo que o seu nível enxerga. E o botão{" "}
            <B>“Pegar próximos 20 para mim”</B> reabastece a carteira com leads do pool.
          </p>
        </>
      ),
    },
    {
      id: "disparos",
      titulo: "Disparos e templates",
      busca: "disparo disparar mensagem massa template email whatsapp inteligente quem pode operador disparador",
      corpo: (
        <>
          <P>
            Disparo é o envio de mensagem em massa (WhatsApp ou e-mail) usando um <B>template</B> — uma
            mensagem pronta e aprovada. Quem pode disparar depende do papel da conta:
          </P>
          <ul className="mt-3 space-y-1.5">
            <Li><B>Administrador e Operador de disparos:</B> disparam em todos os portais.</Li>
            <Li><B>Operador:</B> dispara no <B>Seminário</B> e no <B>Curso de Holding</B> (a abordagem ativa é parte do trabalho de SDR). No HT e no HM, os botões de disparo não aparecem para o operador.</Li>
          </ul>
          <p className="mt-3 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
            No Kanban, dá para disparar para uma etapa inteira, para os selecionados ou usar o{" "}
            <B>Disparo inteligente</B>, que monta sozinho a lista de quem abordar. Leads marcados{" "}
            <B>opt-out</B> nunca recebem disparo. Os templates do portal ficam na tela <B>Templates</B> —
            são eles também que reabrem conversa fechada no Inbox.
          </p>
        </>
      ),
    },
  ], [me, nivel, ehHM, nome]);

  // Busca: filtra seções pelo título+palavras-chave e o FAQ pergunta a pergunta.
  const secoesVisiveis = nq
    ? secoes.filter((s) => norm(s.titulo).includes(nq) || norm(s.busca).includes(nq))
    : secoes;
  const perguntasVisiveis = nq
    ? PERGUNTAS.filter((p) => norm(p.q).includes(nq) || norm(p.busca).includes(nq))
    : PERGUNTAS;
  const nadaEncontrado = nq && secoesVisiveis.length === 0 && perguntasVisiveis.length === 0;

  return (
    <div>
      <PageHeader
        title="Central de Ajuda"
        description="Como trabalhar o sistema no dia a dia — escrito para quem opera, sem tecniquês."
      />

      <div className="lg:grid lg:grid-cols-[220px_1fr] lg:gap-8">
        {/* Índice lateral (some no mobile — as seções ficam empilhadas) */}
        <nav aria-label="Índice da ajuda" className="mb-5 lg:mb-0">
          <div className="lg:sticky lg:top-20">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Nesta página
            </p>
            <ul className="flex flex-wrap gap-1.5 lg:block lg:space-y-0.5">
              {secoes.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="inline-block rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-brand/30 hover:text-brand lg:border-0 lg:px-2 lg:py-1.5 lg:text-[13px] dark:border-slate-700 dark:text-slate-300 dark:hover:text-brand-300"
                  >
                    {s.titulo}
                  </a>
                </li>
              ))}
              <li>
                <a
                  href="#faq"
                  className="inline-block rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:border-brand/30 hover:text-brand lg:border-0 lg:px-2 lg:py-1.5 lg:text-[13px] dark:border-slate-700 dark:text-slate-300 dark:hover:text-brand-300"
                >
                  Erros e dúvidas comuns
                </a>
              </li>
            </ul>
          </div>
        </nav>

        <div className="min-w-0">
          {/* Busca local — filtra as seções e as perguntas ali embaixo. */}
          <div className="mb-5">
            <label htmlFor="busca-ajuda" className="sr-only">Buscar na ajuda</label>
            <div className="relative max-w-md">
              <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
              <input
                id="busca-ajuda"
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar: pool, janela de 24h, card travado…"
                className={cn(fieldClass, "pl-9")}
              />
            </div>
          </div>

          {nadaEncontrado && (
            <Card className="p-6 text-center">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200">Nada encontrado para “{q}”.</p>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Tente outra palavra (ex.: “pool”, “template”, “travado”) ou limpe a busca para ver tudo.
              </p>
            </Card>
          )}

          <div className="space-y-5">
            {secoesVisiveis.map((s) => (
              <section key={s.id} id={s.id} aria-labelledby={`t-${s.id}`} className="scroll-mt-20">
                <Card className="p-5">
                  <h2 id={`t-${s.id}`} className="mb-3 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    {s.titulo}
                  </h2>
                  {s.corpo}
                </Card>
              </section>
            ))}

            {perguntasVisiveis.length > 0 && (
              <section id="faq" aria-labelledby="t-faq" className="scroll-mt-20">
                <Card className="p-5">
                  <h2 id="t-faq" className="mb-1 text-base font-semibold tracking-tight text-slate-900 dark:text-slate-100">
                    Erros e dúvidas comuns
                  </h2>
                  <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
                    As mensagens em vermelho são as que o sistema mostra de verdade — se você viu uma delas,
                    a resposta está aqui.
                  </p>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {perguntasVisiveis.map((p) => (
                      <details key={p.q} className="group py-1">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-2 py-2.5 text-sm font-medium text-slate-800 transition hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/60 [&::-webkit-details-marker]:hidden">
                          {p.q}
                          <svg className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                        </summary>
                        <div className="px-2 pb-3 pt-1">{p.a}</div>
                      </details>
                    ))}
                  </div>
                </Card>
              </section>
            )}
          </div>

          <p className="mt-6 text-xs text-slate-400 dark:text-slate-500">
            Não achou o que precisava? Fale com seu gestor ou com um administrador do Grupo Participa.
          </p>
        </div>
      </div>
    </div>
  );
}
