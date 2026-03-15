// ============================================================
// SERVICE WORKER — Patrulha Mecanizada
// Funciona offline + sincroniza quando voltar a internet
// ============================================================

const CACHE = 'patrulha-v1';
const ASSETS = ['/', '/index.html', '/manifest.json'];

// ── INSTALAR: salva app no cache ──────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

// ── ATIVAR: limpa caches antigos ──────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── INTERCEPTAR REQUESTS ──────────────────────────────────────
self.addEventListener('fetch', e => {
  // Google Apps Script — deixa passar (não cacheia)
  if (e.request.url.includes('script.google.com')) return;

  e.respondWith(
    caches.match(e.request).then(cached => {
      // Se tem no cache, usa — se não, busca na rede
      return cached || fetch(e.request).catch(() => {
        // Se offline e não tem cache, retorna página principal
        if (e.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ── FILA OFFLINE — salva lançamentos sem internet ─────────────
const DB_NAME = 'patrulha_offline';
const DB_STORE = 'fila';

function openDB(){
  return new Promise((res,rej)=>{
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore(DB_STORE, {keyPath:'id'});
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}

// Salvar lançamento na fila offline
async function salvarFila(record){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).put(record);
    tx.oncomplete = () => res(true);
    tx.onerror = e => rej(e.target.error);
  });
}

// Buscar todos da fila
async function lerFila(){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(DB_STORE,'readonly');
    const req = tx.objectStore(DB_STORE).getAll();
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

// Remover da fila após sincronizar
async function removerFila(id){
  const db = await openDB();
  return new Promise((res,rej)=>{
    const tx = db.transaction(DB_STORE,'readwrite');
    tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = () => res(true);
    tx.onerror = e => rej(e.target.error);
  });
}

// ── BACKGROUND SYNC — envia fila quando voltar a internet ─────
self.addEventListener('sync', e => {
  if(e.tag === 'sync-patrulha'){
    e.waitUntil(sincronizarFila());
  }
});

async function sincronizarFila(){
  const fila = await lerFila();
  const GAS = 'https://script.google.com/macros/s/AKfycbwrOTKgO8K54vuSAaFKt6rZM4kQFT7pTuiMC4cxAlUruCMX_KFZOFKEvKV8VZVuTHqZ/exec';

  for(const record of fila){
    try{
      const r = await fetch(GAS, {
        method:'POST', redirect:'follow',
        headers:{'Content-Type':'text/plain'},
        body: JSON.stringify({action:'save', record})
      });
      const j = await r.json();
      if(j.ok){
        await removerFila(record.id);
        // Notifica o app que foi sincronizado
        const clients = await self.clients.matchAll();
        clients.forEach(c => c.postMessage({type:'SYNCED', id:record.id}));
      }
    }catch(e){
      console.log('Sync falhou para ID:', record.id, e.message);
    }
  }
}

// ── MENSAGENS DO APP ──────────────────────────────────────────
self.addEventListener('message', async e => {
  if(e.data.type === 'SAVE_OFFLINE'){
    await salvarFila(e.data.record);
    // Registra sync para quando voltar internet
    try{
      await self.registration.sync.register('sync-patrulha');
    }catch(err){
      // Fallback: tenta sincronizar manualmente
      sincronizarFila();
    }
    e.source.postMessage({type:'SAVED_OFFLINE', id:e.data.record.id});
  }
  if(e.data.type === 'GET_QUEUE'){
    const fila = await lerFila();
    e.source.postMessage({type:'QUEUE_DATA', fila});
  }
});
