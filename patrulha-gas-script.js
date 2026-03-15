// ============================================================
// PATRULHA MECANIZADA — Backend Google Apps Script v2
// Secretaria Municipal de Agricultura e Meio Ambiente
// Prefeitura de Tabaporã – MT
// ============================================================

// ESTRUTURA DE PASTAS:
// 📁 PATRULHA MECANIZADA – SMAM TABAPORÃ
//    📄 REQUERIMENTOS
//    📋 ORDENS DE SERVIÇO
//    📍 IMAGEM - ÁREA DEMARCADA
//    🌾 IMAGEM - ÁREAS (ANTES e DEPOIS)
//    📊 Registros (planilha)

function getPastaRaiz() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('PM_PASTA_RAIZ');
  if (id) { try { return DriveApp.getFolderById(id); } catch(e) {} }

  // Tenta encontrar a pasta existente "Dados APP - Patrulha Mecanizada"
  const NOME_PASTA = 'Dados APP - Patrulha Mecanizada';
  const pastas = DriveApp.getFoldersByName(NOME_PASTA);
  if (pastas.hasNext()) {
    const pasta = pastas.next();
    props.setProperty('PM_PASTA_RAIZ', pasta.getId());
    return pasta;
  }

  // Se não encontrar, cria dentro do Drive raiz
  const pasta = DriveApp.createFolder(NOME_PASTA);
  props.setProperty('PM_PASTA_RAIZ', pasta.getId());
  return pasta;
}

function getSubPasta(nome) {
  const props = PropertiesService.getScriptProperties();
  const chave = 'PM_PASTA_' + nome.replace(/[^A-Za-z0-9]/g, '_');
  let id = props.getProperty(chave);
  if (id) { try { return DriveApp.getFolderById(id); } catch(e) {} }
  const sub = getPastaRaiz().createFolder(nome);
  props.setProperty(chave, sub.getId());
  return sub;
}

function salvarImagem(base64, nomePasta, nomeArq) {
  if (!base64 || base64.length < 50) return null;
  try {
    const dados = base64.replace(/^data:image\/\w+;base64,/, '');
    const blob = Utilities.newBlob(Utilities.base64Decode(dados), 'image/jpeg', nomeArq + '.jpg');
    const arq = getSubPasta(nomePasta).createFile(blob);
    return arq.getUrl();
  } catch(e) { Logger.log('Erro imagem: ' + e.message); return null; }
}

function getOrCreateSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  let ssId = props.getProperty('PM_SPREADSHEET_ID');
  if (ssId) { try { return SpreadsheetApp.openById(ssId); } catch(e) {} }

  const raiz = getPastaRaiz();
  const ss = SpreadsheetApp.create('📊 Registros – Patrulha Mecanizada Tabaporã');
  ssId = ss.getId();
  props.setProperty('PM_SPREADSHEET_ID', ssId);
  const file = DriveApp.getFileById(ssId);
  raiz.addFile(file);
  DriveApp.getRootFolder().removeFile(file);

  // Aba Registros
  const reg = ss.getActiveSheet();
  reg.setName('Registros');
  reg.appendRow([
    'id','nOrdem','dataOS','operador','maquinario','implemento',
    'cpfProdutor','nomeProdutor','whatsapp','imovel',
    'tipoServico','hectares','horIni','horFin','totalHoras','valorHora','valorTotal',
    'enviadoEm','imgCount',
    'urlRequerimento','urlOrdemServico','urlAreaAntes','urlAreaDepois','urlAreaDemarcacao'
  ]);
  reg.setFrozenRows(1);
  reg.getRange(1,1,1,24).setFontWeight('bold').setBackground('#1a3c5e').setFontColor('white');

  // Aba Imagens
  const img = ss.insertSheet('Imagens');
  img.appendRow(['id','requerimento','ordemServico','areaAntes','areaDepois','areaDemarcacao']);
  img.setFrozenRows(1);
  img.getRange(1,1,1,6).setFontWeight('bold').setBackground('#0f5c2e').setFontColor('white');

  return ss;
}

function doGet(e)  { return route(e.parameter, null); }
function doPost(e) {
  let body = null;
  try { body = JSON.parse(e.postData.contents); } catch(ex) {}
  return route(e.parameter, body);
}

function route(params, body) {
  try {
    const action = (body && body.action) || (params && params.action) || '';
    const ss = getOrCreateSpreadsheet();
    if (action === 'ping') {
      const ssId = PropertiesService.getScriptProperties().getProperty('PM_SPREADSHEET_ID');
      const pastaId = PropertiesService.getScriptProperties().getProperty('PM_PASTA_RAIZ');
      return ok({
        status: 'ok',
        msg: 'Patrulha Mecanizada – banco conectado!',
        url: ssId ? SpreadsheetApp.openById(ssId).getUrl() : '',
        pastaUrl: pastaId ? 'https://drive.google.com/drive/folders/' + pastaId : ''
      });
    }
    if (action === 'list')   return ok(listRecords(ss));
    if (action === 'get')    return ok(getRecord(ss, (body&&body.id)||(params&&params.id)));
    if (action === 'save')   return ok(saveRecord(ss, body.record));
    if (action === 'delete') return ok(deleteRecord(ss, (body&&body.id)||(params&&params.id)));
    return err('Ação desconhecida: ' + action);
  } catch(e) { return err(e.message); }
}

function listRecords(ss) {
  const sheet = ss.getSheetByName('Registros');
  const data  = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const hdrs = data[0];
  return data.slice(1)
    .map(row => Object.fromEntries(hdrs.map((h,i) => [h, row[i]])))
    .filter(r => r.id)
    .sort((a,b) => Number(b.id) - Number(a.id));
}

function getRecord(ss, id) {
  const sid = String(id);
  const regSheet = ss.getSheetByName('Registros');
  const imgSheet = ss.getSheetByName('Imagens');
  const regData = regSheet.getDataRange().getValues();
  const regHdrs = regData[0];
  const regRow  = regData.slice(1).find(r => String(r[0]) === sid);
  if (!regRow) throw new Error('Registro não encontrado: ' + sid);
  const record = Object.fromEntries(regHdrs.map((h,i) => [h, regRow[i]]));

  // Imagens
  record.imagens = {requerimento:null,ordemServico:null,areaAntes:null,areaDepois:null,areaDemarcacao:null};
  const imgData = imgSheet.getDataRange().getValues();
  const imgHdrs = imgData[0];
  const imgRow  = imgData.slice(1).find(r => String(r[0]) === sid);
  if (imgRow) imgHdrs.forEach((h,i) => { if(h !== 'id') record.imagens[h] = imgRow[i] || null; });

  return record;
}

function getPastaLancamentos() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('PM_PASTA_OS');
  if (id) { try { return DriveApp.getFolderById(id); } catch(e) {} }
  // Procura pasta "OS - Arquivo" já existente dentro da raiz
  const raiz = getPastaRaiz();
  const encontradas = raiz.getFoldersByName('OS - Arquivo');
  if (encontradas.hasNext()) {
    const pasta = encontradas.next();
    props.setProperty('PM_PASTA_OS', pasta.getId());
    return pasta;
  }
  // Se não existir, cria
  const sub = raiz.createFolder('OS - Arquivo');
  props.setProperty('PM_PASTA_OS', sub.getId());
  return sub;
}

function getPastaOS(nOrdem, nomeProdutor, dataOS) {
  const props = PropertiesService.getScriptProperties();
  const chave = 'PM_OS_' + String(nOrdem);
  let id = props.getProperty(chave);
  if (id) { try { return DriveApp.getFolderById(id); } catch(e) {} }
  // Format: OS 001 - NOME PRODUTOR - 14/03/2026
  const data = dataOS ? dataOS.split('T')[0] : '';
  const dataBR = data ? data.split('-').reverse().join('/') : '';
  const nome = (nomeProdutor||'PRODUTOR').toUpperCase().substring(0,25);
  const nomePasta = 'OS ' + String(nOrdem).padStart(3,'0') + ' - ' + nome + (dataBR?' - '+dataBR:'');
  // Cria dentro da pasta "OS - DADOS DOS LANÇAMENTOS"
  const pastaLanc = getPastaLancamentos();
  const sub = pastaLanc.createFolder(nomePasta);
  props.setProperty(chave, sub.getId());
  return sub;
}

function salvarImagemOS(base64, pasta, nomeArq) {
  if (!base64 || base64.length < 50) return null;
  try {
    const dados = base64.replace(/^data:image\/\w+;base64,/, '');
    const blob = Utilities.newBlob(Utilities.base64Decode(dados), 'image/jpeg', nomeArq + '.jpg');
    const arq = pasta.createFile(blob);
    return arq.getUrl();
  } catch(e) { Logger.log('Erro imagem: ' + e.message); return null; }
}

function saveRecord(ss, r) {
  const sid  = String(r.id);
  const imgs = r.imagens || {};

  // Cria pasta individual para a OS
  const pastaOS = getPastaOS(r.nOrdem||sid, r.nomeProdutor, r.dataOS);
  const base = 'OS'+(r.nOrdem||sid);

  const urlReq  = salvarImagemOS(imgs.requerimento,   pastaOS, base+'_REQUERIMENTO');
  const urlOS   = salvarImagemOS(imgs.ordemServico,   pastaOS, base+'_ORDEM_SERVICO');
  const urlAnt  = salvarImagemOS(imgs.areaAntes,      pastaOS, base+'_AREA_ANTES');
  const urlDep  = salvarImagemOS(imgs.areaDepois,     pastaOS, base+'_AREA_DEPOIS');
  const urlDemc = salvarImagemOS(imgs.areaDemarcacao, pastaOS, base+'_AREA_DEMARCADA');

  const ic = [imgs.requerimento,imgs.ordemServico,imgs.areaAntes,imgs.areaDepois,imgs.areaDemarcacao].filter(Boolean).length;

  const metaRow = [
    r.id, r.nOrdem, r.dataOS, r.operador, r.maquinario, r.implemento,
    r.cpfProdutor, r.nomeProdutor, r.whatsapp, r.imovel,
    r.tipoServico, r.hectares, r.horIni, r.horFin, r.totalHoras, r.valorHora, r.valorTotal,
    r.enviadoEm, ic,
    urlReq||'', urlOS||'', urlAnt||'', urlDep||'', urlDemc||''
  ];
  upsertRow(ss.getSheetByName('Registros'), sid, metaRow);

  upsertRow(ss.getSheetByName('Imagens'), sid, [
    sid,
    imgs.requerimento||'', imgs.ordemServico||'',
    imgs.areaAntes||'', imgs.areaDepois||'', imgs.areaDemarcacao||''
  ]);

  return { saved: true };
}

function deleteRecord(ss, id) {
  const sid = String(id);
  deleteRow(ss.getSheetByName('Registros'), sid);
  deleteRow(ss.getSheetByName('Imagens'), sid);
  return { deleted: true };
}

function upsertRow(sheet, id, row) {
  const data = sheet.getDataRange().getValues();
  const idx  = data.findIndex((r,i) => i > 0 && String(r[0]) === id);
  if (idx >= 0) sheet.getRange(idx+1,1,1,row.length).setValues([row]);
  else          sheet.appendRow(row);
}

function deleteRow(sheet, id) {
  const data = sheet.getDataRange().getValues();
  const idx  = data.findIndex((r,i) => i > 0 && String(r[0]) === id);
  if (idx >= 0) sheet.deleteRow(idx+1);
}

// ── RESET (executar uma vez se necessário) ───────────────────
function resetProps(){
  PropertiesService.getScriptProperties().deleteAllProperties();
  Logger.log('✅ Propriedades limpas! Pode executar lançamentos agora.');
}

function ok(data)  { return resp({ok:true,  data:data}); }
function err(msg)  { return resp({ok:false, error:msg}); }
function resp(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
