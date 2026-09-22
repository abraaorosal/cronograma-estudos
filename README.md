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
- cache local para funcionamento contínuo mesmo sem sincronização configurada.

## Execução local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

A publicação em GitHub Pages é feita automaticamente pelo workflow em `.github/workflows/deploy-pages.yml`.

## Privacidade da sincronização

O cronograma é público no código-fonte. Dados pessoais de progresso não são gravados no repositório. Quando a sincronização é ativada, o navegador cifra o estado antes de enviá-lo ao armazenamento remoto. A chave de sincronização e o PIN devem ser guardados pelo usuário.
