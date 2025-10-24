// Script properties centralize environment configuration outside source control.
const LEILAO_ENV_PROPS = PropertiesService.getScriptProperties();

function leilaoGetEnv_(key, fallback) {
  const value = LEILAO_ENV_PROPS.getProperty(key);

  if (value === null || value === undefined || value === '') {
    if (arguments.length === 2) {
      return fallback;
    }
    throw new Error('Missing script property: ' + key);
  }

  return value;
}

function leilaoGetEnvNumber_(key, fallback) {
  const raw = LEILAO_ENV_PROPS.getProperty(key);

  if (raw === null || raw === undefined || raw === '') {
    if (arguments.length === 2) {
      return fallback;
    }
    throw new Error('Missing script property for numeric key: ' + key);
  }

  const value = Number(raw);

  if (Number.isNaN(value)) {
    throw new Error('Invalid numeric script property for ' + key + ': ' + raw);
  }

  return value;
}
/***********************
 *  CONFIGURAÇÕES
 ***********************/
const LEILAO_CFG = {
  PIPEDRIVE_API_TOKEN: leilaoGetEnv_('PIPEDRIVE_API_TOKEN'),
  PIPEDRIVE_DOMAIN: leilaoGetEnv_('PIPEDRIVE_DOMAIN', 'https://api.pipedrive.com/v1'),
  TZ: leilaoGetEnv_('TIMEZONE', 'America/Sao_Paulo'),
  ACTIVITY_TYPE: leilaoGetEnv_('ACTIVITY_TYPE', 'task')
};

/***********************
 *  FIELD KEYS
 ***********************/
const LEILAO_FIELD_KEYS = {
  modalidadeVenda: 'bc1e81e929031d8af4f22e51937ea34dbdd05a5f',
  dataTerminoTriagem: 'fb1aa427746a8e05d6dadc6eccfc51dd1cdc992d'
};

/***********************
 *  MODALIDADE IDS
 ***********************/
const LEILAO_MODALIDADE_IDS = {
  LEILAO_UNICO: '299',
  PRIMEIRO_LEILAO: '28',
  SEGUNDO_LEILAO: '29',
  LICITACAO_ABERTA: '30',
  VENDA_ONLINE: '31',
  VENDA_DIRETA_ONLINE: '32'
};

/***********************
 *  WEBHOOK CONFIG
 ***********************/
const LEILAO_WEBHOOK_SHEET_ID = leilaoGetEnv_('WEBHOOK_SHEET_ID');
const LEILAO_WEBHOOK_LOG_SHEET = leilaoGetEnv_('WEBHOOK_LOG_SHEET', 'WebhookLog');
const LEILAO_WEBHOOK_ERR_SHEET = leilaoGetEnv_('WEBHOOK_ERROR_SHEET', 'WebhookErrors');
const LEILAO_WEBHOOK_ALLOWED_DEAL = (function() {
  const raw = LEILAO_ENV_PROPS.getProperty('WEBHOOK_ALLOWED_DEAL');
  if (!raw) return null; // null = todos | número específico = modo teste
  const value = Number(raw);
  if (Number.isNaN(value)) {
    throw new Error('Invalid WEBHOOK_ALLOWED_DEAL; expected numeric value, got: ' + raw);
  }
  return value;
})();
const LEILAO_WEBHOOK_LOCK_SECONDS = leilaoGetEnvNumber_('WEBHOOK_LOCK_SECONDS', 90);
const LEILAO_WEBHOOK_MAX_LOG_ROWS = leilaoGetEnvNumber_('WEBHOOK_MAX_LOG_ROWS', 200);
const LEILAO_WEBHOOK_MAX_ERR_ROWS = leilaoGetEnvNumber_('WEBHOOK_MAX_ERR_ROWS', 100);

/***********************
 *  REQUISIÇÕES PIPEDRIVE
 ***********************/
function leilaoPd_(endpoint, options) {
  const url = LEILAO_CFG.PIPEDRIVE_DOMAIN + endpoint + 
              (endpoint.includes('?') ? '&' : '?') + 
              'api_token=' + LEILAO_CFG.PIPEDRIVE_API_TOKEN;
  
  const params = Object.assign({
    method: 'get',
    contentType: 'application/json',
    muteHttpExceptions: true
  }, options || {});
  
  if (params.payload && typeof params.payload === 'object') {
    params.payload = JSON.stringify(params.payload);
  }
  
  const response = UrlFetchApp.fetch(url, params);
  const code = response.getResponseCode();
  const text = response.getContentText();
  
  if (code < 200 || code >= 300) {
    throw new Error('Pipedrive Error ' + code + ': ' + text);
  }
  
  return JSON.parse(text);
}

/***********************
 *  FUNÇÕES DE DATA
 ***********************/
function leilaoTzToday_() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: LEILAO_CFG.TZ }));
}

function leilaoParseLocalDate_(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split('-');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[0]);
  const m = parseInt(parts[1]) - 1;
  const d = parseInt(parts[2]);
  return new Date(y, m, d);
}

function leilaoYmd_(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function leilaoAddDays_(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function leilaoIsWeekend_(date) {
  const day = date.getDay();
  return day === 0 || day === 6;
}

function leilaoNextBusinessDay_(date) {
  let result = new Date(date);
  while (leilaoIsWeekend_(result)) {
    result.setDate(result.getDate() + 1);
  }
  return result;
}

/***********************
 *  NORMALIZAÇÃO
 ***********************/
function leilaoNormalizeSubject_(subject) {
  return String(subject || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/***********************
 *  ATIVIDADES - LISTAGEM
 ***********************/
function leilaoListActivitiesAll_(dealId) {
  try {
    const response = leilaoPd_('/deals/' + dealId + '/activities?limit=500');
    return (response && response.data) || [];
  } catch (err) {
    Logger.log('Erro ao listar atividades: %s', err.message);
    return [];
  }
}

/***********************
 *  ATIVIDADES - VERIFICAÇÃO
 ***********************/
function leilaoActivityExistsStrong_({ dealId, subject, dueDateYmd, dueTime }) {
  try {
    const activities = leilaoListActivitiesAll_(dealId);
    const normalized = leilaoNormalizeSubject_(subject);
    
    for (const act of activities) {
      const actSubj = leilaoNormalizeSubject_(act.subject);
      const actDate = act.due_date || '';
      const actTime = act.due_time || '';
      
      if (actSubj === normalized && actDate === dueDateYmd && actTime === dueTime) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    Logger.log('Erro verificação forte: %s', err.message);
    return false;
  }
}

function leilaoActivityExistsBySubject_({ dealId, subject }) {
  try {
    const activities = leilaoListActivitiesAll_(dealId);
    const normalized = leilaoNormalizeSubject_(subject);
    
    for (const act of activities) {
      const actSubj = leilaoNormalizeSubject_(act.subject);
      if (actSubj === normalized) {
        return true;
      }
    }
    
    return false;
  } catch (err) {
    return false;
  }
}

/***********************
 *  CACHE DE PRIORIDADES (IGUAL IPTU)
 ***********************/
if (typeof LEILAO_PRIORITY_IDS_CACHE === 'undefined') {
  var LEILAO_PRIORITY_IDS_CACHE = null;
}

function leilaoGetPriorityIds_() {
  if (LEILAO_PRIORITY_IDS_CACHE) return LEILAO_PRIORITY_IDS_CACHE;
  
  try {
    const resp = leilaoPd_('/activityFields');
    if (resp && resp.data) {
      const priorityField = resp.data.find(f => f.key === 'priority');
      
      if (priorityField && priorityField.options && Array.isArray(priorityField.options)) {
        const options = {};
        priorityField.options.forEach(opt => {
          const label = String(opt.label || '').toLowerCase();
          if (label.includes('high') || label.includes('alta') || label.includes('alto')) {
            options.HIGH = opt.id;
          } else if (label.includes('medium') || label.includes('média') || label.includes('medio')) {
            options.MEDIUM = opt.id;
          } else if (label.includes('low') || label.includes('baixa') || label.includes('bajo')) {
            options.LOW = opt.id;
          }
        });
        
        LEILAO_PRIORITY_IDS_CACHE = options;
        Logger.log('🎯 IDs de prioridade carregados: ' + JSON.stringify(options));
        return options;
      }
    }
  } catch (err) {
    Logger.log('⚠️ Erro ao buscar prioridades, usando fallback: ' + err.message);
  }
  
  // Fallback
  LEILAO_PRIORITY_IDS_CACHE = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  return LEILAO_PRIORITY_IDS_CACHE;
}

function leilaoGetPriorityValue_(priority) {
  const ids = leilaoGetPriorityIds_();
  
  switch(priority) {
    case 'high':
      return ids.HIGH || 3;
    case 'medium':
      return ids.MEDIUM || 2;
    case 'low':
      return ids.LOW || 1;
    default:
      return ids.MEDIUM || 2;
  }
}

/***********************
 *  ATIVIDADES - CRIAÇÃO (COM PRIORIDADES DINÂMICAS)
 ***********************/
function leilaoCreateActivity_({ deal, subject, note, dueDate, dueTime, priority }) {
  const payload = {
    subject: subject,
    note: note || '',
    deal_id: deal.id,
    due_date: leilaoYmd_(dueDate),
    due_time: dueTime || '10:00',
    type: LEILAO_CFG.ACTIVITY_TYPE,
    user_id: deal.user_id ? deal.user_id.id : null
  };
  
  // Usa IDs dinâmicos de prioridade (igual IPTU)
  if (priority) {
    payload.priority = leilaoGetPriorityValue_(priority);
  }
  
  try {
    const response = leilaoPd_('/activities', {
      method: 'post',
      payload: payload
    });
    
    Logger.log('✅ Atividade criada: %s (prioridade: %s = %s)', subject, priority, payload.priority);
    return response;
  } catch (err) {
    Logger.log('❌ Erro ao criar atividade: %s', err.message);
    throw err;
  }
}

/***********************
 *  VERIFICADORES DE MODALIDADE
 ***********************/
function leilaoIsPositivo_(modalidade) {
  const modalidadeStr = String(modalidade || '').trim();
  return (
    modalidadeStr === LEILAO_MODALIDADE_IDS.PRIMEIRO_LEILAO ||
    modalidadeStr === LEILAO_MODALIDADE_IDS.SEGUNDO_LEILAO
  );
}

function leilaoIsNegativo_(modalidade) {
  const modalidadeStr = String(modalidade || '').trim();
  return (
    modalidadeStr === LEILAO_MODALIDADE_IDS.LICITACAO_ABERTA ||
    modalidadeStr === LEILAO_MODALIDADE_IDS.VENDA_ONLINE ||
    modalidadeStr === LEILAO_MODALIDADE_IDS.VENDA_DIRETA_ONLINE
  );
}

/***********************
 *  PLANOS - LEILÕES POSITIVOS
 ***********************/
const LEILAO_POSITIVO_PLAN = {
  title: (day) => `LEILÃO POSITIVO - ${day} ${day === 1 ? 'DIA' : 'DIAS'} - ${LEILAO_POSITIVO_PLAN.actions[day]}`,
  
  actions: {
    1: 'INICIAR',
    3: 'VERIFICAR DOCUMENTOS',
    5: 'STATUS DA DOCUMENTAÇÃO',
    7: 'COBRAR PENDÊNCIAS',
    10: 'VERIFICAR DOCUMENTAÇÃO'
  },
  
  note: (day) => {
    const notes = {
      1: 'Confira se os documentos básicos estão no Drive (editais, atas, procurações).\nSolicitar documentos externos (agência; leiloeiro; arrematante).\nPreencher lateral do Pipedrive com executor e dados de início.',
      
      3: 'Confirme se todos os documentos já foram recebidos.\nCaso falte algum, cobrar imediatamente o responsável.\nFaça verificação dos documentos para validar assinaturas e formato PDF/A.\nArquivar no Drive com nomenclatura padrão os documentos recebidos.',
      
      5: 'Valide se todos os documentos foram salvos na pasta correta.\nCaso completo, finalizar o setor e atualize o pipe.\nCaso incompleto, verifique o que falta e realize nova solicitação.',
      
      7: 'Verificar se toda a documentação já foi inserida na pasta do imóvel.\nCaso haja pendência, cobrar diretamente o responsável pela emissão e reforçar prazo de regularização.',
      
      10: 'Confirmar se foram anexadas no Drive as certidões e documentos complementares exigidos pelo cartório.\nConferir se já houve resposta a eventuais notas devolutivas.\nCaso não, cobrar o responsável imediato pela emissão da documentação e informar o supervisor diante da demora.'
    };
    return notes[day] || '';
  },
  
  days: [
    { day: 1, hour: 10, priority: 'high' },    // 🔴 Alta
    { day: 3, hour: 10, priority: 'medium' },  // 🟠 Média
    { day: 5, hour: 10, priority: 'high' },    // 🔴 Alta
    { day: 7, hour: 10, priority: 'medium' },  // 🟠 Média
    { day: 10, hour: 10, priority: 'high' }    // 🔴 Alta
  ]
};

/***********************
 *  PLANOS - LEILÕES NEGATIVOS
 ***********************/
const LEILAO_NEGATIVO_PLAN = {
  title: (day) => `LEILÃO NEGATIVO - ${day} ${day === 1 ? 'DIA' : 'DIAS'} - ${LEILAO_NEGATIVO_PLAN.actions[day]}`,
  
  actions: {
    1: 'INICIAR',
    3: 'VERIFICAR SITUAÇÃO COM CEF',
    5: 'STATUS DO PROCESSO',
    7: 'ACOMPANHAR ANDAMENTO',
    10: 'ALERTA: COBRANÇA',
    14: 'ALERTA: MONITORAMENTO',
    16: 'ALERTA: PRAZO PRÓXIMO',
    18: 'SINAL DE RISCO',
    20: 'ALERTA DE DESCUMPRIMENTO DE PRAZO',
    25: 'DESCUMPRIMENTO TOTAL',
    30: 'PRAZO FINAL / CRÍTICO'
  },
  
  note: (day) => {
    const notes = {
      1: 'Conferir matrícula no Drive: verifique se já consta averbação de leilão negativa. Caso não, verifique e-mails da CEF sobre possível conclusão/andamento de averbação.\nCaso não esteja averbado e não tenha e-mail da CEF dispondo sobre o andamento, preencha o formulário de leilões.\nPreencher lateral do Pipedrive com executor, dados de início e status.',
      
      3: 'Monitorar caixa de entrada para resposta do CEMAB11.\nCaso não tenha retorno, mande outro e-mail solicitando resposta.',
      
      5: 'Verifique se houve retorno da CEF:\nSe a averbação estiver concluída → atualizar o Pipedrive.\nSe o protocolo foi informado → acompanhar na ONR.\nSe for prazo para retorno de até 10 dias → criar atividade futura para em 2 dias cobrar retorno.\nSe não houver retorno, preencher outro formulário informando que já teve atendimento e que está aguardando resposta.',
      
      7: 'Confirme o status do protocolo no ONR e a data de vencimento.\nSe não houver resposta, identifique o leiloeiro responsável pelos leilões positivos e entre em contato solicitando atualização da averbação.',
      
      10: 'Se a CEF informou retorno em até 10 dias, verifique a caixa de entrada.\nCaso não haja resposta, informe o supervisor para que entre em contato diretamente com o canal de suporte da CEMAB.\nSe o protocolo estiver em andamento, verifique a atualização na ONR.',
      
      14: 'Verifique se houve atualização por parte da CEF.\nAtualizar o cliente sobre o andamento do processo.',
      
      16: 'Confirmar se a CEF já encaminhou o resultado definitivo.\nCaso não, ou muito tempo sem retorno, repita os procedimentos iniciais de envio de e-mail e preenchimento do formulário.',
      
      18: 'Verifique o vencimento do protocolo informado pela CEF.\nFaça cobrança para andamento urgente para o cartório, CEF e leiloeiro.',
      
      20: 'Caso não finalizado, avalie como crítico.\nInformar o cliente da situação com justificativa e plano de ação devido ao não cumprimento do prazo.\nAtualizar "Data Término" no Pipedrive quando for averbado.',
      
      25: 'Verificar se o fluxo do leilão foi concluído (assinatura, averbação se necessário e liberação final).\nCaso não, cobrar urgência ao cartório/leiloeiro/gerente, conforme o ponto de atraso, e comunicar cliente sobre o atraso e reforçar acompanhamento próximo.',
      
      30: 'Se ainda não concluído:\nVerificar com o cartório se há possibilidade de dilação da prenotação.\nComunicar ao cliente e formalizar o risco de vencimento do protocolo.\nSe concluído: salvar documentação final no Drive e atualizar Pipedrive.'
    };
    return notes[day] || '';
  },
  
  days: [
    { day: 1, hour: 10, priority: 'high' },    // 🔴 Alta
    { day: 3, hour: 10, priority: 'medium' },  // 🟠 Média
    { day: 5, hour: 10, priority: 'medium' },  // 🟠 Média
    { day: 7, hour: 10, priority: 'medium' },  // 🟠 Média
    { day: 10, hour: 10, priority: 'high' },   // 🔴 Alta
    { day: 14, hour: 10, priority: 'medium' }, // 🟠 Média
    { day: 16, hour: 10, priority: 'medium' }, // 🟠 Média
    { day: 18, hour: 10, priority: 'high' },   // 🔴 Alta
    { day: 20, hour: 10, priority: 'high' },   // 🔴 Alta
    { day: 25, hour: 10, priority: 'high' },   // 🔴 Alta
    { day: 30, hour: 10, priority: 'high' }    // 🔴 Alta
  ]
};

/***********************
 *  FUNÇÃO PRINCIPAL - CRIAR ATIVIDADES
 ***********************/
function leilaoCreateActivities_(deal) {
  const modalidade = deal[LEILAO_FIELD_KEYS.modalidadeVenda];
  const dataTriagem = deal[LEILAO_FIELD_KEYS.dataTerminoTriagem];
  
  if (!dataTriagem) {
    Logger.log('Deal %s sem data triagem', deal.id);
    return { ok: false, error: 'missing_triagem' };
  }
  
  const baseDate = leilaoParseLocalDate_(dataTriagem);
  const today = leilaoTzToday_();
  
  let plan, tipo;
  
  if (leilaoIsPositivo_(modalidade)) {
    plan = LEILAO_POSITIVO_PLAN;
    tipo = 'POSITIVO';
  } else if (leilaoIsNegativo_(modalidade)) {
    plan = LEILAO_NEGATIVO_PLAN;
    tipo = 'NEGATIVO';
  } else {
    Logger.log('Deal %s com modalidade não reconhecida: %s', deal.id, modalidade);
    return { ok: false, error: 'invalid_modalidade' };
  }
  
  let created = 0, skipped = 0;
  const createdActivities = [];
  
  // Backlog (atividades passadas)
  for (const config of plan.days) {
    const d = config.day;
    const hour = config.hour;
    const priority = config.priority || 'medium';
    const dueRaw = leilaoAddDays_(baseDate, d);
    const dueBday = leilaoNextBusinessDay_(dueRaw);
    
    if (dueBday <= today) {
      const subject = plan.title(d);
      const note = plan.note(d);
      const dueY = leilaoYmd_(dueBday);
      const dueTime = String(hour).padStart(2, '0') + ':00';
      
      if (leilaoActivityExistsStrong_({ dealId: deal.id, subject, dueDateYmd: dueY, dueTime })) {
        skipped++;
        continue;
      }
      
      leilaoCreateActivity_({ deal, subject, note, dueDate: dueBday, dueTime, priority });
      created++;
      createdActivities.push(`✓ ${subject}`);
    }
  }
  
  // Próxima atividade futura
  const nextConfig = plan.days.find(cfg => {
    const dueRaw = leilaoAddDays_(baseDate, cfg.day);
    const dueBday = leilaoNextBusinessDay_(dueRaw);
    return dueBday > today;
  });
  
  if (nextConfig) {
    const d = nextConfig.day;
    const hour = nextConfig.hour;
    const priority = nextConfig.priority || 'medium';
    const subject = plan.title(d);
    const note = plan.note(d);
    const dueRaw = leilaoAddDays_(baseDate, d);
    const dueBday = leilaoNextBusinessDay_(dueRaw);
    const dueY = leilaoYmd_(dueBday);
    const dueTime = String(hour).padStart(2, '0') + ':00';
    
    if (!leilaoActivityExistsStrong_({ dealId: deal.id, subject, dueDateYmd: dueY, dueTime })) {
      leilaoCreateActivity_({ deal, subject, note, dueDate: dueBday, dueTime, priority });
      created++;
      createdActivities.push(`✓ ${subject}`);
    } else {
      skipped++;
    }
  }
  
  Logger.log('Deal %s: %s criadas, %s puladas (%s)', deal.id, created, skipped, tipo);
  
  return { ok: true, created, skipped, tipo, createdActivities };
}

/***********************
 *  🧪 TESTE - DEAL 11176
 ***********************/
function testarLeiloes() {
  Logger.log('═══════════════════════════════════════');
  Logger.log('🧪 TESTANDO LEILÕES - DEAL 11176');
  Logger.log('═══════════════════════════════════════');
  
  const DEAL_ID = 11176;
  
  try {
    const dealResp = leilaoPd_('/deals/' + DEAL_ID);
    const deal = dealResp && dealResp.data;
    
    if (!deal) {
      Logger.log('❌ Deal %s não encontrado', DEAL_ID);
      return;
    }
    
    Logger.log('✅ Deal: %s', deal.title);
    Logger.log('📋 Modalidade: %s', deal[LEILAO_FIELD_KEYS.modalidadeVenda]);
    Logger.log('📅 Data Triagem: %s', deal[LEILAO_FIELD_KEYS.dataTerminoTriagem]);
    
    const result = leilaoCreateActivities_(deal);
    
    Logger.log('');
    Logger.log('📊 RESULTADO:');
    Logger.log('✅ Criadas: %s', result.created);
    Logger.log('⏭️ Puladas: %s', result.skipped);
    Logger.log('🏷️ Tipo: %s', result.tipo || 'N/A');
    Logger.log('═══════════════════════════════════════');
    
  } catch (err) {
    Logger.log('❌ ERRO: %s', err.message);
    Logger.log('Stack: %s', err.stack);
  }
}

