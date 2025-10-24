/***********************
 *  WEBHOOK HANDLER - LEILÕES v1.3 COMPLETO
 ***********************/

const LEILAO_WEBHOOK_LOCK = PropertiesService.getScriptProperties();

/***********************
 *  VERIFICADORES DE MODALIDADE
 ***********************/
function leilaoIsPositivo_(modalidade) {
  const LEILAO_UNICO = "299";
  const PRIMEIRO_LEILAO = "28";
  const SEGUNDO_LEILAO = "29";

  const modalidadeStr = String(modalidade || "").trim();
  return (
    modalidadeStr === LEILAO_UNICO ||
    modalidadeStr === PRIMEIRO_LEILAO ||
    modalidadeStr === SEGUNDO_LEILAO
  );
}

function leilaoIsNegativo_(modalidade) {
  const LICITACAO_ABERTA = "30";
  const VENDA_ONLINE = "31";
  const VENDA_DIRETA_ONLINE = "32";

  const modalidadeStr = String(modalidade || "").trim();
  return (
    modalidadeStr === LICITACAO_ABERTA ||
    modalidadeStr === VENDA_ONLINE ||
    modalidadeStr === VENDA_DIRETA_ONLINE
  );
}

/***********************
 *  LOCK
 ***********************/
function leilaoWebhookIsProcessing_(dealId) {
  const key = `LEILAO_LOCK_${dealId}`;
  const now = Date.now();

  try {
    const lastProcessed = LEILAO_WEBHOOK_LOCK.getProperty(key);

    if (lastProcessed) {
      const elapsed = (now - parseInt(lastProcessed)) / 1000;

      if (elapsed < LEILAO_WEBHOOK_LOCK_SECONDS) {
        Logger.log("🔒 Deal %s bloqueado (%.1fs atrás)", dealId, elapsed);
        return true;
      }
    }

    LEILAO_WEBHOOK_LOCK.setProperty(key, String(now));
    Logger.log("🔓 Lock adquirido: deal %s", dealId);
    return false;
  } catch (err) {
    Logger.log("⚠️ Erro ao verificar lock: %s", err.message);
    return false;
  }
}

/***********************
 *  LOGS
 ***********************/
function leilaoWebhookAppendLog_({
  timestamp,
  dealId,
  title,
  action,
  atividadesCriadas,
  detalhes,
}) {
  try {
    const ss = SpreadsheetApp.openById(LEILAO_WEBHOOK_SHEET_ID);
    let sh = ss.getSheetByName(LEILAO_WEBHOOK_LOG_SHEET);

    if (!sh) {
      sh = ss.insertSheet(LEILAO_WEBHOOK_LOG_SHEET);
      sh.getRange(1, 1, 1, 6)
        .setValues([
          [
            "Timestamp",
            "DealID",
            "Title",
            "Action",
            "Atividades Criadas",
            "Detalhes",
          ],
        ])
        .setFontWeight("bold")
        .setBackground("#4285f4")
        .setFontColor("#ffffff");
      sh.setFrozenRows(1);
    }

    sh.appendRow([
      Utilities.formatDate(
        timestamp || new Date(),
        LEILAO_CFG.TZ,
        "dd/MM/yyyy, HH:mm:ss"
      ),
      String(dealId || ""),
      String(title || ""),
      String(action || ""),
      String(atividadesCriadas || ""),
      String(detalhes || ""),
    ]);

    const lastRow = sh.getLastRow();
    if (action === "Processamento Leilão") {
      sh.getRange(lastRow, 1, 1, 6).setBackground("#d9ead3");
    }

    if (lastRow > LEILAO_WEBHOOK_MAX_LOG_ROWS + 1) {
      sh.deleteRows(2, lastRow - LEILAO_WEBHOOK_MAX_LOG_ROWS - 1);
    }
  } catch (err) {
    Logger.log("Erro log: %s", err.message);
  }
}

function leilaoWebhookAppendError_(where, error, eventData) {
  try {
    const ss = SpreadsheetApp.openById(LEILAO_WEBHOOK_SHEET_ID);
    let sh = ss.getSheetByName(LEILAO_WEBHOOK_ERR_SHEET);

    if (!sh) {
      sh = ss.insertSheet(LEILAO_WEBHOOK_ERR_SHEET);
      sh.getRange(1, 1, 1, 5)
        .setValues([["Timestamp", "DealID", "Erro", "Stack Trace", "Payload"]])
        .setFontWeight("bold")
        .setBackground("#ea4335")
        .setFontColor("#ffffff");
      sh.setFrozenRows(1);
    }

    const timestamp = Utilities.formatDate(
      new Date(),
      LEILAO_CFG.TZ,
      "dd/MM/yyyy, HH:mm:ss"
    );
    const errorMessage =
      error && error.message ? String(error.message) : String(error);
    const stackTrace = error && error.stack ? String(error.stack) : "N/A";

    let dealId = "",
      payloadText = "";
    try {
      if (eventData && eventData.postData && eventData.postData.contents) {
        const payload = JSON.parse(eventData.postData.contents);
        const current = payload.data || payload.current || {};
        dealId = String(current.id || "");
        payloadText = JSON.stringify(payload, null, 2);
      }
    } catch (parseErr) {
      payloadText = "N/A";
    }

    if (payloadText.length > 50000)
      payloadText = payloadText.substring(0, 50000);

    sh.appendRow([timestamp, dealId, errorMessage, stackTrace, payloadText]);
    sh.getRange(sh.getLastRow(), 1, 1, 5).setBackground("#f4cccc");

    const lastRow = sh.getLastRow();
    if (lastRow > LEILAO_WEBHOOK_MAX_ERR_ROWS + 1) {
      sh.deleteRows(2, lastRow - LEILAO_WEBHOOK_MAX_ERR_ROWS - 1);
    }
  } catch (err) {
    Logger.log("Erro crítico: %s", err.message);
  }
}

/***********************
 *  HANDLER PRINCIPAL
 ***********************/
function doPost(e) {
  const logId = Utilities.getUuid().substring(0, 8);

  try {
    Logger.log("🚀 WEBHOOK LEILÕES [%s]", logId);

    const raw =
      e && e.postData && e.postData.contents ? e.postData.contents : "";
    if (!raw) throw new Error("Sem corpo");

    const payload = JSON.parse(raw);
    const meta = payload.meta || {};
    let current = payload.data || payload.current || payload;
    const previous = payload.previous || {};

    const dealId = current.id || current.dealId || payload.dealId || "";
    const title = current.title || payload.title || "";

    const isDealEvent = !!(
      dealId &&
      (meta.object === "deal" || meta.action === "updated")
    );

    if (
      LEILAO_WEBHOOK_ALLOWED_DEAL &&
      String(dealId) !== String(LEILAO_WEBHOOK_ALLOWED_DEAL)
    ) {
      Logger.log("🚫 Deal %s não permitido", dealId);
      return ContentService.createTextOutput(
        JSON.stringify({ ok: true, skipped: "deal_not_allowed" })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (!isDealEvent || !dealId) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: true, skipped: "not_deal" })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (leilaoWebhookIsProcessing_(dealId)) {
      return ContentService.createTextOutput(
        JSON.stringify({ ok: true, skipped: "locked" })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    let fullDeal = current;
    try {
      const r = leilaoPd_("/deals/" + dealId);
      if (r && r.data) fullDeal = r.data;
    } catch (errDeal) {
      Logger.log("⚠️ Erro ao buscar deal: %s", errDeal.message);
    }

    const triagemFieldKey = LEILAO_FIELD_KEYS.dataTerminoTriagem;
    const currentTriagem = fullDeal[triagemFieldKey];

    let previousTriagem = null;
    if (previous && previous[triagemFieldKey] !== undefined) {
      const val = previous[triagemFieldKey];
      previousTriagem =
        val && typeof val === "object" && val.value !== undefined
          ? val.value
          : val;
    }

    if (!currentTriagem || previousTriagem) {
      Logger.log("⏭️ Sem mudança em Data Triagem");
      return ContentService.createTextOutput(
        JSON.stringify({ ok: true, skipped: "no_triagem_change" })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    Logger.log("✅ Data Triagem preenchida: %s", currentTriagem);

    const result = leilaoCreateActivities_(fullDeal);

    let atividadesTexto = "Nenhuma",
      detalhesTexto = "";

    if (result.created > 0) {
      atividadesTexto = result.createdActivities
        ? result.createdActivities.join("\n")
        : `${result.created} criada(s)`;
      detalhesTexto = `${result.created} criada(s) - ${result.tipo}`;
    } else {
      detalhesTexto = `${result.skipped} já existente(s)`;
    }

    leilaoWebhookAppendLog_({
      timestamp: new Date(),
      dealId: dealId,
      title: title,
      action: "Processamento Leilão",
      atividadesCriadas: atividadesTexto,
      detalhes: detalhesTexto,
    });

    Logger.log(
      "✅ Concluído [%s]: %s criadas (%s)",
      logId,
      result.created,
      result.tipo
    );

    return ContentService.createTextOutput(
      JSON.stringify({ ok: true, dealId, result })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log("❌ ERRO [%s]: %s", logId, err.message);
    leilaoWebhookAppendError_("doPost", err, e);
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({
      status: "online",
      service: "Webhook Leilões v1.3 FINAL",
      timestamp: new Date().toISOString(),
      allowedDeal: LEILAO_WEBHOOK_ALLOWED_DEAL || "todos",
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

/***********************
 *  🧪 TESTE MANUAL
 ***********************/
function testarWebhookManual() {
  Logger.log("═══════════════════════════════════════");
  Logger.log("🧪 TESTE MANUAL WEBHOOK - DEAL 11176");
  Logger.log("═══════════════════════════════════════");

  const DEAL_ID = 11176;

  try {
    const dealResp = leilaoPd_("/deals/" + DEAL_ID);
    const deal = dealResp && dealResp.data;

    if (!deal) {
      Logger.log("❌ Deal não encontrado");
      return;
    }

    Logger.log("✅ Deal: %s", deal.title);
    Logger.log("📋 Modalidade: %s", deal[LEILAO_FIELD_KEYS.modalidadeVenda]);
    Logger.log(
      "📅 Data Triagem: %s",
      deal[LEILAO_FIELD_KEYS.dataTerminoTriagem]
    );

    const dataTriagem = deal[LEILAO_FIELD_KEYS.dataTerminoTriagem];

    if (!dataTriagem) {
      Logger.log("❌ Data Triagem não preenchida!");
      return;
    }

    Logger.log("");
    Logger.log("--- PROCESSANDO ATIVIDADES ---");

    const result = leilaoCreateActivities_(deal);

    if (!result.ok) {
      Logger.log("❌ Erro: %s", result.error);
      return;
    }

    Logger.log("");
    Logger.log("--- SALVANDO NA PLANILHA ---");

    let atividadesTexto = "Nenhuma",
      detalhesTexto = "";

    if (result.created > 0) {
      atividadesTexto = result.createdActivities
        ? result.createdActivities.join("\n")
        : `${result.created} criada(s)`;
      detalhesTexto = `${result.created} criada(s) - ${result.tipo}`;
    } else {
      detalhesTexto = `${result.skipped} já existente(s)`;
    }

    leilaoWebhookAppendLog_({
      timestamp: new Date(),
      dealId: DEAL_ID,
      title: deal.title,
      action: "Processamento Leilão",
      atividadesCriadas: atividadesTexto,
      detalhes: detalhesTexto,
    });

    Logger.log("✅ Log salvo na planilha!");
    Logger.log("");
    Logger.log("📊 RESULTADO:");
    Logger.log("✅ Criadas: %s", result.created);
    Logger.log("⏭️ Puladas: %s", result.skipped);
    Logger.log("🏷️ Tipo: %s", result.tipo);
    Logger.log("═══════════════════════════════════════");
  } catch (err) {
    Logger.log("❌ ERRO: %s", err.message);
    leilaoWebhookAppendError_("testarWebhookManual", err, null);
  }
}

function leilaoLimparLocks() {
  const allProps = LEILAO_WEBHOOK_LOCK.getProperties();
  let count = 0;

  for (const key in allProps) {
    if (key.startsWith("LEILAO_LOCK_")) {
      LEILAO_WEBHOOK_LOCK.deleteProperty(key);
      count++;
    }
  }

  Logger.log("✅ %s locks removidos", count);
}
