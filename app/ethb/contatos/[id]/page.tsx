// Ficha do aluno no ETHB = a MESMA tela do HM (0155), recortada por
// produto='ETHB' via useProdutoHm(). 16/08: hm-drawer.tsx, tag-picker.tsx e
// agendamentos/page.tsx linkavam `/hm/contatos/${id}` fixo — do ETHB o clique
// caía no portal HM e, sem HM na whitelist, expulsava a pessoa. Reexport para
// não duplicar a ficha.
export { default } from "@/app/hm/contatos/[id]/page";
