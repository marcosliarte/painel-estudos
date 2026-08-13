# Painel de Estudos

App desktop (Electron) para acompanhar horas de estudo, questões feitas e um caderno de erros — com dados salvos em um banco SQLite embutido (nenhum serviço externo é necessário).

## Estrutura do projeto

```
src/
  main/                  processo principal do Electron (Node.js)
    main.js              cria a janela e inicializa o banco
    preload.js           ponte segura entre a janela e o backend
    db.js                abre o SQLite (better-sqlite3) e cria as tabelas
    models/               funções de acesso às tabelas (Subject, StudyEntry, MistakeEntry)
    ipc/                   handlers que respondem às chamadas da janela
  renderer/              interface (roda dentro da janela)
    index.html
    css/styles.css
    js/app.js
```

## Requisitos

- Node.js

## Rodando em modo desenvolvimento

```
npm install
npm start
```

`npm install` já recompila o `better-sqlite3` para a versão do Electron (via `postinstall`).

## Gerando o instalador (.exe)

```
npm run dist
```

O instalador fica em `dist/`. Depois de instalado, o app abre com duplo clique, sem precisar de terminal, navegador ou banco de dados externo.

## Banco de dados

- Arquivo: `painel_estudos.db`, dentro da pasta de dados do usuário do app (`app.getPath("userData")` — no Windows, algo como `%APPDATA%\painel-de-estudos\`)
- Tabelas: `subjects`, `study_entries`, `mistake_entries`
- É criado automaticamente na primeira execução; nenhum serviço precisa estar rodando.

## Backup

Os botões "Backup" e "Restaurar" no topo do app exportam/importam um arquivo `.json` com todos os dados, via caixa de diálogo do sistema.
