# OAB 48 · Plano de Aprovação

Painel pessoal de preparação para a 1ª fase do 48º Exame de Ordem Unificado.

## Recursos

- cronograma diário de 23/09/2026 a 09/01/2027, com 2 horas por dia;
- estudo espiralado das matérias de maior incidência;
- revisões automáticas em D+1, D+3, D+7, D+14 e D+30;
- controle de questões, acertos, tempo e progresso por disciplina;
- caderno de erros minimalista;
- acompanhamento de simulados e meta operacional de 50+/80;
- sincronização opcional entre navegadores com criptografia AES-GCM no cliente;
- compactação dos dados sincronizados para manter o histórico leve;
- cache local para funcionamento contínuo mesmo sem sincronização configurada.

## Publicação

Cada atualização da branch `main` executa o workflow `.github/workflows/deploy-pages.yml`, compila o React/Vite e publica o resultado pronto na branch `gh-pages`.

Para usar o domínio nativo do GitHub Pages, habilite uma única vez em:

**Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: gh-pages / (root)**

Depois disso, o endereço canônico será:

`https://abraaorosal.github.io/cronograma-estudos/`

## Execução local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Privacidade da sincronização

O cronograma é público no código-fonte. Dados pessoais de progresso não são gravados no repositório.

Quando a sincronização é ativada:

1. o navegador compacta o estado da aplicação;
2. deriva uma chave criptográfica do PIN informado;
3. cifra os dados com AES-GCM;
4. envia somente o conteúdo cifrado ao armazenamento remoto.

Para restaurar em outro navegador, são necessários a **chave de sincronização** e o **PIN**. Guarde ambos em local seguro.

O armazenamento remoto utilizado é o JSONStorage. Ele funciona como camada de persistência para aplicações estáticas; o conteúdo enviado por este painel já sai cifrado do navegador.
