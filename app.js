// Configuración - URL del Apps Script publicado (planilla "Pedidos_Clark")
const GOOGLE_SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxR0b0A-uatCGN1CEhjFKIyMuw2jI0nP-cc2pd10KkGF9-UwECN_UBZlJoX7CFameQc/exec';

// Cliente fijo de este sistema (usado en el registro y como referencia visual)
const CLIENTE = 'Clark';
const LOCAL_CACHE_KEY = 'clark_pedidos_cache_v1';

let currentUser = null;
let orderHistory = [];

document.addEventListener('DOMContentLoaded', () => {
  generateQR();
  checkSession();
  loadHistory();
});

// Genera el QR con la URL real donde esté publicada esta página
function generateQR() {
  const holder = document.getElementById('qrcode');
  if (!holder || typeof QRCode === 'undefined') return;
  new QRCode(holder, {
    text: window.location.href,
    width: 176,
    height: 176,
    colorDark: '#23241f',
    colorLight: '#ffffff',
    correctLevel: QRCode.CorrectLevel.H
  });
}

function checkSession() {
  try {
    const saved = localStorage.getItem('clark_logged_user');
    if (saved) { currentUser = JSON.parse(saved); showMainPanel(); }
  } catch (e) {}
}

function login() {
  const name = document.getElementById('userName').value.trim();
  if (!name) { document.getElementById('userName').focus(); return; }
  currentUser = { name, loginTime: new Date().toISOString() };
  try { localStorage.setItem('clark_logged_user', JSON.stringify(currentUser)); } catch (e) {}
  showMainPanel();
}

function logout() {
  try { localStorage.removeItem('clark_logged_user'); } catch (e) {}
  currentUser = null;
  document.getElementById('mainPanel').classList.remove('active');
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('actionBar').style.display = 'none';
  document.getElementById('userName').value = '';
}

function showMainPanel() {
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('mainPanel').classList.add('active');
  document.getElementById('displayUserName').textContent = currentUser.name;
  document.getElementById('userInitial').textContent = currentUser.name.trim().charAt(0).toUpperCase() || '–';
  document.getElementById('actionBar').style.display = 'flex';
}

function showNotice(message) {
  const notice = document.getElementById('syncNotice');
  document.getElementById('syncNoticeText').innerHTML = message;
  notice.classList.remove('hidden');
}

function hideNotice() {
  document.getElementById('syncNotice').classList.add('hidden');
}

// Trae el historial real desde la planilla de Google Sheets
async function loadHistory() {
  try {
    const response = await fetch(GOOGLE_SHEETS_URL);
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (Array.isArray(data)) {
      orderHistory = data.reverse();
      cacheLocally();
      hideNotice();
      filterHistory();
      return;
    }
    throw new Error('Respuesta inesperada');
  } catch (error) {
    console.log('No se pudo sincronizar con Google Sheets:', error);
    loadFromLocalCache();
    showNotice('<strong>Sin conexión con Google Sheets.</strong> Mostrando el último historial guardado en este dispositivo. Los nuevos pedidos se reintentarán enviar.');
  }
}

function loadFromLocalCache() {
  try {
    const raw = localStorage.getItem(LOCAL_CACHE_KEY);
    orderHistory = raw ? JSON.parse(raw) : [];
  } catch (e) { orderHistory = []; }
  filterHistory();
}

function cacheLocally() {
  try { localStorage.setItem(LOCAL_CACHE_KEY, JSON.stringify(orderHistory)); } catch (e) {}
}

async function confirmOrder(event) {
  event.preventDefault();

  const orderNumber = document.getElementById('orderNumber').value.trim();
  const location = document.getElementById('location').value;
  const palletCount = document.getElementById('palletCount').value;
  const orderStatus = document.getElementById('orderStatus').value;
  const observations = document.getElementById('observations').value.trim();

  if (!orderNumber || !location || !palletCount || !orderStatus) return;

  const data = {
    user: currentUser.name,
    client: CLIENTE,
    orderNumber, location,
    palletCount: parseInt(palletCount, 10),
    status: orderStatus,
    observations: observations || 'N/A',
    timestamp: new Date().toISOString(),
    date: new Date().toLocaleString('es-AR')
  };

  const btn = document.getElementById('submitBtn');
  btn.disabled = true;
  btn.textContent = 'Confirmando…';

  try {
    await saveToGoogleSheets(data);
  } catch (error) {
    console.error('Error al guardar en Google Sheets:', error);
  }

  // Optimista: lo mostramos ya en el historial local mientras se sincroniza
  orderHistory.unshift(data);
  cacheLocally();
  document.getElementById('searchOrder').value = '';
  filterHistory();
  showConfirmation(data);
  document.getElementById('orderForm').reset();

  btn.disabled = false;
  btn.textContent = 'Confirmar pedido';

  // Reintenta traer el historial real de la planilla a los pocos segundos
  setTimeout(loadHistory, 3000);
}

function saveToGoogleSheets(data) {
  // mode: 'no-cors' evita el preflight de Apps Script (no soporta OPTIONS);
  // a cambio no podemos leer si el guardado tuvo éxito del lado del servidor.
  return fetch(GOOGLE_SHEETS_URL, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(data)
  });
}

// Filtra el historial por número de pedido según lo escrito en el buscador
function filterHistory() {
  const term = document.getElementById('searchOrder').value.trim().toLowerCase();
  const filtered = term
    ? orderHistory.filter(item => (item.orderNumber || '').toString().toLowerCase().includes(term))
    : orderHistory;
  renderHistoryList(filtered);
}

function renderHistoryList(list) {
  const container = document.getElementById('historyList');
  if (list.length === 0) {
    container.innerHTML = '<p class="history-empty">NO HAY REGISTROS</p>';
    return;
  }
  container.innerHTML = list.map(item => `
    <div class="history-item">
      <div class="row-top">
        <span class="order-no">${escapeHtml(item.orderNumber)}</span>
        <span class="status-pill" data-status="${escapeHtml(item.status || '')}">${escapeHtml(item.status || '—')}</span>
      </div>
      <div class="meta">
        <span>Ubicación: <b>${escapeHtml(item.location)}</b></span>
        <span>Pallets: <b>${escapeHtml(String(item.palletCount))}</b></span>
        <span>Por: <b>${escapeHtml(item.user)}</b></span>
      </div>
      ${item.observations && item.observations !== 'N/A' ? `<div class="obs">${escapeHtml(item.observations)}</div>` : ''}
      <div class="stamp">${escapeHtml(item.date || new Date(item.timestamp).toLocaleString('es-AR'))}</div>
    </div>
  `).join('');
}

function showConfirmation(data) {
  document.getElementById('confirmationDetails').innerHTML = `
    <div><span>Pedido</span><span>${escapeHtml(data.orderNumber)}</span></div>
    <div><span>Cliente</span><span>${escapeHtml(data.client)}</span></div>
    <div><span>Ubicación</span><span>${escapeHtml(data.location)}</span></div>
    <div><span>Pallets</span><span>${escapeHtml(String(data.palletCount))}</span></div>
    <div><span>Estado</span><span>${escapeHtml(data.status)}</span></div>
    <div><span>Registrado por</span><span>${escapeHtml(data.user)}</span></div>
    <div><span>Fecha</span><span>${escapeHtml(data.date)}</span></div>
  `;
  document.getElementById('confirmationModal').classList.add('active');
}

function closeModal() {
  document.getElementById('confirmationModal').classList.remove('active');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirmationModal').addEventListener('click', (e) => {
    if (e.target.id === 'confirmationModal') closeModal();
  });
});

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
