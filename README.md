# ⚙️ Automação de Atividades de Leilões

![Google Apps Script](https://img.shields.io/badge/Google%20Apps%20Script-4285F4?logo=google&logoColor=white)
![Pipedrive API](https://img.shields.io/badge/Pipedrive%20API-00b594?logo=pipedrive&logoColor=white)
![Automação](https://img.shields.io/badge/Automação-Leilões-orange)

## 📌 Visão Geral

Este repositório contém uma automação em Google Apps Script (GAS) que cria atividades no Pipedrive para negócios de leilão e registra logs em uma planilha do Google Sheets a partir de webhooks.

## ✨ Destaques

- 🧭 Funções auxiliares para montar o plano positivo/negativo de atividades.
- 🔁 Webhook com lock, logging estruturado e quarentena de erros.
- 🧪 Funções de teste prontas para validar integrações (`testarLeiloes` e `testarWebhookManual`).

## 🧱 Estrutura do Projeto

- 📄 `main.gs`: núcleo da automação e utilitários.
- 📬 `webhook.gs`: processamento do webhook, lock e logs em Sheets.
- 🧷 `.env`: credenciais locais (não versionadas).
- 🗂️ `.env.example`: modelo com todas as variáveis necessárias.
- 🚫 `.gitignore`: mantém segredos e artefatos fora do Git.

## 🛠️ Configuração

### 1️⃣ Preparar o Ambiente Local

1. 📁 Copie `.env.example` para `.env` (`cp .env.example .env`).
2. ✏️ Preencha os campos obrigatórios no `.env` (ex.: `PIPEDRIVE_API_TOKEN`, `WEBHOOK_SHEET_ID`).
3. 🛡️ Use o `.env` apenas localmente; ele já está ignorado pelo Git.

### 2️⃣ Mapear Variáveis ➜ Script Properties

Cadastre as chaves abaixo em **Project Settings > Script Properties** dentro do Apps Script:

| Chave                | Obrigatório? | Default                      | Descrição                                            |
| -------------------- | ------------ | ---------------------------- | ---------------------------------------------------- |
| PIPEDRIVE_API_TOKEN  | Sim          | -                            | Token de acesso da API do Pipedrive.                 |
| PIPEDRIVE_DOMAIN     | Sim          | https://api.pipedrive.com/v1 | Endpoint base da API opcional.                       |
| TIMEZONE             | Sim          | America/Sao_Paulo            | Timezone usado para cálculos de data.                |
| ACTIVITY_TYPE        | Sim          | task                         | Tipo de atividade criada no Pipedrive.               |
| WEBHOOK_SHEET_ID     | Sim          | -                            | ID da planilha usada para logs.                      |
| WEBHOOK_LOG_SHEET    | Sim          | WebhookLog                   | Nome da aba onde as execuções são registradas.       |
| WEBHOOK_ERROR_SHEET  | Sim          | WebhookErrors                | Nome da aba de erros.                                |
| WEBHOOK_ALLOWED_DEAL | Não          | null                         | ID específico permitido (ou deixe vazio para todos). |
| WEBHOOK_LOCK_SECONDS | Sim          | 90                           | Tempo do lock anti-duplicidade.                      |
| WEBHOOK_MAX_LOG_ROWS | Sim          | 200                          | Limite de linhas de log.                             |
| WEBHOOK_MAX_ERR_ROWS | Sim          | 100                          | Limite de linhas de erro.                            |

#### 🔄 Sincronizar .env ➜ Script Properties

Se você já preencheu o `.env`, pode gerar automaticamente uma função com os mesmos valores:

1. ✅ Garanta que possui Node.js instalado localmente.
2. 💻 Execute `node scripts/export-script-properties.js`.
3. 📋 Copie a função `seedPropertiesFromEnv` exibida no terminal e cole em um arquivo temporário no editor do Apps Script.
4. ▶️ Execute `seedPropertiesFromEnv` uma única vez (menu `Executar`) para popular todas as Script Properties.
5. 🧹 Remova a função do projeto após a sincronização para manter o token fora do código.

## 🧪 Desenvolvimento e Testes

- ▶️ `testarLeiloes`: carrega o negócio de teste configurado e cria as atividades previstas.
- 📡 `testarWebhookManual`: simula a chamada do webhook, cria atividades e registra em planilha.
- 🧼 `leilaoLimparLocks`: remove locks de execução armazenados em Script Properties.

Execute as funções acima pelo editor do Apps Script (menu `Executar`) para validar o ambiente antes do deploy. ✅

## 🚀 Deploy

1. 🔗 Ajuste os triggers/webhooks no Pipedrive para apontar para a URL publicada (`doPost`).
2. 🌐 Publique o script como Web App no Apps Script (`Deploy > Manage deployments`).
3. ⬆️ Se estiver usando `clasp`, mantenha `.clasp.json` fora do versionamento e execute `clasp push` após editar os `.gs`.


---


