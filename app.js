// ==========================================
// MULTI-CLIENT REGISTRY (?id=malabar)
// ==========================================
const CLIENTS = {
  malabar: "https://script.google.com/macros/s/AKfycbwmmAdVYs25ryvZp-ds3-n3xoXD_Xyspuz9Kqa1WcuM9VLJwckDGYmTPt0K8wHoaERd/exec",
  // Add new clients below:
  // alfahamhub: "YOUR_NEXT_CLIENT_WEB_APP_URL",
};

const urlParams = new URLSearchParams(window.location.search);
const clientId = (urlParams.get("id") || "").toLowerCase().trim();
const API_URL = clientId ? CLIENTS[clientId] : null;

// Escape text coming from the Google Sheet before putting it in HTML
const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Cart persistence (per store, survives refresh)
const CART_KEY = `foodcart_cart_${clientId}`;
function saveCart() {
  try {
    const data = Object.values(cart).map(e => ({ id: e.item.id, n: e.item.name, v: e.variantIdx, q: e.qty }));
    localStorage.setItem(CART_KEY, JSON.stringify(data));
  } catch (_) {}
}
function loadCart() {
  try {
    const data = JSON.parse(localStorage.getItem(CART_KEY) || '[]');
    data.forEach(d => {
      const item = menuItems.find(i => i.id === d.id && i.name === d.n);
      const variant = item && item.variants[d.v];
      if (item && variant && d.q > 0) {
        cart[`${d.id}__${d.v}`] = { item, variant, variantIdx: d.v, qty: d.q };
      }
    });
  } catch (_) {}
}

let menuItems = [];
let settings = {};
let selectedVariants = {};
let cart = {};
let activeCategory = 'All';
let vegOnly = false;
let orderMode = 'delivery';
let gpsLink = '';
let isStoreOpen = true;
let isLandmarkRequired = true;

function format12Hour(hhmm) {
  if (!hhmm || !hhmm.includes(':')) return hhmm;
  const [hStr, mStr] = hhmm.split(':');
  let h = parseInt(hStr, 10);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${mStr} ${ampm}`;
}

// Current time in the SHOP's timezone (not the customer's phone)
function shopNowMinutes() {
  const tz = settings['Time Zone'] || 'Asia/Kolkata';
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  } catch (_) {
    parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date());
  }
  const h = parseInt(parts.find(p => p.type === 'hour').value, 10) % 24;
  const m = parseInt(parts.find(p => p.type === 'minute').value, 10);
  return h * 60 + m;
}

function computeStoreOpenState() {
  const mode = (settings['Shop Status'] || 'OPEN').toUpperCase().trim();
  const openStr = settings['Open Time'] || '';
  const closeStr = settings['Close Time'] || '';

  if (mode === 'OPEN') {
    return { open: true, hoursText: openStr && closeStr ? `${format12Hour(openStr)} – ${format12Hour(closeStr)}` : '' };
  }
  if (mode === 'CLOSED') {
    return { open: false, hoursText: openStr && closeStr ? `Opens at ${format12Hour(openStr)}` : '' };
  }

  if (mode === 'AUTO' && openStr.includes(':') && closeStr.includes(':')) {
    const [oH, oM] = openStr.split(':').map(Number);
    const [cH, cM] = closeStr.split(':').map(Number);
    const curMins = shopNowMinutes();
    const openMins = oH * 60 + oM;
    const closeMins = cH * 60 + cM;

    const openNow = closeMins > openMins
      ? (curMins >= openMins && curMins < closeMins)
      : (curMins >= openMins || curMins < closeMins);

    return {
      open: openNow,
      hoursText: `${format12Hour(openStr)} – ${format12Hour(closeStr)}`
    };
  }

  return { open: true, hoursText: '' };
}

async function init() {
  // Show default FoodCart screen when no ?id= parameter is provided
  if (!clientId) {
    document.getElementById('landingScreen').classList.remove('hidden');
    return;
  }

  // Otherwise show Store Menu App
  document.getElementById('storeApp').classList.remove('hidden');

  if (!API_URL) {
    document.getElementById('skeleton').innerHTML = `
      <div class="p-6 text-center bg-white rounded-2xl border border-red-100 text-red-600 text-sm font-semibold space-y-3">
        <p>Store ID "<strong>${esc(clientId)}</strong>" not found. Please check the QR link.</p>
        <a href="./" class="inline-block text-xs font-bold text-orange-600 underline">← Back to FoodCart Home</a>
      </div>`;
    return;
  }

  try {
    const res = await fetch(API_URL);
    const data = await res.json();
    if (!data.ok) throw new Error('Invalid API response');
    settings = data.settings || {};
    menuItems = data.items || [];
    menuItems.forEach(it => selectedVariants[it.id] = 0);
    loadCart();
    applySettings();
    renderCategories();
    renderMenu();
    updateFloatingCart();
  } catch (err) {
    document.getElementById('skeleton').innerHTML = `
      <div class="p-6 text-center bg-white rounded-2xl border border-red-100 text-red-600 text-sm font-semibold">
        Unable to load menu. Please check API URL or internet connection.
      </div>`;
  }
}

function applySettings() {
  const name = settings['Shop Name'] || 'FoodCart Store';
  document.title = `${name} — FoodCart`;
  document.getElementById('shopName').textContent = name;
  document.getElementById('shopTagline').textContent = settings['Tagline'] || 'Freshly prepared & delivered fast';
  document.getElementById('deliveryInfoText').textContent = settings['Delivery Info'] || 'Fast Home Delivery & Takeaway Available';

  const landmarkSetting = (settings['Landmark Required'] || 'TRUE').toUpperCase().trim();
  isLandmarkRequired = landmarkSetting !== 'FALSE' && landmarkSetting !== 'NO';

  const addressInput = document.getElementById('custAddress');
  if (addressInput) {
    addressInput.placeholder = isLandmarkRequired
      ? 'House / Flat Name, Area, Landmark *'
      : 'House / Flat Name, Area, Landmark (Optional)';
  }

  if (settings['Theme Color']) {
    document.documentElement.style.setProperty('--brand', settings['Theme Color']);
  }
  if (settings['Phone']) {
    const callBtn = document.getElementById('callBtn');
    callBtn.href = `tel:${settings['Phone']}`;
    callBtn.classList.remove('hidden');
  }
  if (settings['Maps Link']) {
    const mapBtn = document.getElementById('mapBtn');
    mapBtn.href = settings['Maps Link'];
    mapBtn.classList.remove('hidden');
  }

  const storeState = computeStoreOpenState();
  isStoreOpen = storeState.open;

  if (storeState.hoursText) {
    const timingBadge = document.getElementById('timingBadge');
    timingBadge.textContent = `🕒 ${storeState.hoursText}`;
    timingBadge.classList.remove('hidden');
  }

  if (!isStoreOpen) {
    document.getElementById('closedBanner').classList.remove('hidden');
    if (settings['Open Time']) {
      document.getElementById('closedBannerText').textContent =
        `Store is currently closed (Hours: ${storeState.hoursText}). You can still browse the menu.`;
    }
    const pill = document.getElementById('statusPill');
    pill.className = 'inline-flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-200';
    pill.innerHTML = `<span class="w-1.5 h-1.5 rounded-full bg-red-500"></span> CLOSED`;
  }
}

function renderCategories() {
  const cats = ['All', ...new Set(menuItems.map(i => i.category))];
  const bar = document.getElementById('categoryBar');
  bar.innerHTML = cats.map(c => {
    const active = c === activeCategory;
    return `<button data-cat="${esc(c)}" class="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${active ? 'brand-bg text-white shadow-sm' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}">${esc(c)}</button>`;
  }).join('');
}

document.getElementById('categoryBar').addEventListener('click', e => {
  const btn = e.target.closest('[data-cat]');
  if (btn) selectCategory(btn.dataset.cat);
});

function selectCategory(cat) {
  activeCategory = cat;
  renderCategories();
  renderMenu();
}

document.getElementById('searchInput').addEventListener('input', renderMenu);
document.getElementById('vegToggle').addEventListener('click', () => {
  vegOnly = !vegOnly;
  const btn = document.getElementById('vegToggle');
  btn.className = vegOnly
    ? 'px-3 py-2 rounded-xl border border-emerald-600 bg-emerald-50 text-xs font-bold text-emerald-700 flex items-center gap-1.5 shrink-0 transition'
    : 'px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 flex items-center gap-1.5 shrink-0 transition';
  renderMenu();
});

function selectVariant(itemId, idx) {
  selectedVariants[itemId] = idx;
  renderMenu();
}

function updateQty(itemId, variantIdx, delta) {
  if (!isStoreOpen && delta > 0) {
    alert('Sorry, the store is currently closed for online orders.');
    return;
  }
  const key = `${itemId}__${variantIdx}`;
  const item = menuItems.find(i => i.id === itemId);
  const variant = item.variants[variantIdx];

  if (!cart[key] && delta > 0) {
    cart[key] = { item, variant, variantIdx, qty: 0 };
  }
  if (cart[key]) {
    cart[key].qty += delta;
    if (cart[key].qty <= 0) delete cart[key];
  }
  saveCart();
  renderMenu();
  updateFloatingCart();
  if (!document.getElementById('checkoutModal').classList.contains('hidden')) {
    renderCheckoutModal();
  }
}

function renderMenu() {
  document.getElementById('skeleton').classList.add('hidden');
  const container = document.getElementById('menuContainer');
  const q = document.getElementById('searchInput').value.toLowerCase().trim();

  const filtered = menuItems.filter(item => {
    if (activeCategory !== 'All' && item.category !== activeCategory) return false;
    if (vegOnly && item.type.toLowerCase() !== 'veg') return false;
    if (q && !item.name.toLowerCase().includes(q) && !item.description.toLowerCase().includes(q) && !item.category.toLowerCase().includes(q)) return false;
    return true;
  });

  if (filtered.length === 0) {
    container.classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
    return;
  }

  document.getElementById('emptyState').classList.add('hidden');
  container.classList.remove('hidden');

  const grouped = {};
  filtered.forEach(it => {
    if (!grouped[it.category]) grouped[it.category] = [];
    grouped[it.category].push(it);
  });

  container.innerHTML = Object.entries(grouped).map(([cat, items]) => `
    <section>
      <div class="flex items-center justify-between mb-2.5">
        <h2 class="text-base font-extrabold text-slate-900">${esc(cat)}</h2>
        <span class="text-[11px] font-bold text-slate-400">${items.length} items</span>
      </div>
      <div class="space-y-3">
        ${items.map(renderItemCard).join('')}
      </div>
    </section>
  `).join('');
}

function renderItemCard(item) {
  const isVeg = item.type.toLowerCase() === 'veg';
  const isSoldOut = item.status.toLowerCase().trim() === 'sold out';
  const vIdx = selectedVariants[item.id] || 0;
  const activeVariant = item.variants[vIdx];
  const cartKey = `${item.id}__${vIdx}`;
  const qty = cart[cartKey]?.qty || 0;
  const hasMultipleVariants = item.variants.length > 1;

  const dotHtml = isVeg
    ? `<span class="w-3.5 h-3.5 border border-emerald-600 flex items-center justify-center rounded-[3px] shrink-0"><span class="w-1.5 h-1.5 rounded-full bg-emerald-600"></span></span>`
    : `<span class="w-3.5 h-3.5 border border-red-600 flex items-center justify-center rounded-[3px] shrink-0"><span class="w-1.5 h-1.5 rounded-full bg-red-600"></span></span>`;

  const variantsHtml = hasMultipleVariants ? `
    <div class="flex flex-wrap gap-1.5 mt-2.5">
      ${item.variants.map((v, idx) => `
        <button onclick="selectVariant('${item.id}', ${idx})" class="px-2.5 py-1 rounded-lg text-xs font-bold border transition ${idx === vIdx ? 'brand-border bg-orange-50 brand-text' : 'border-slate-200 text-slate-600 bg-slate-50'}">
          ${esc(v.label)} • ₹${v.price}
        </button>
      `).join('')}
    </div>
  ` : '';

  let actionHtml = '';
  if (isSoldOut) {
    actionHtml = `<span class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold">Sold Out</span>`;
  } else if (!isStoreOpen) {
    actionHtml = `<span class="px-3 py-1.5 rounded-xl bg-slate-100 text-slate-400 text-xs font-bold">Closed</span>`;
  } else if (qty === 0) {
    actionHtml = `<button onclick="updateQty('${item.id}', ${vIdx}, 1)" class="px-4 py-2 rounded-xl border-2 brand-border brand-text hover:bg-orange-50 font-extrabold text-xs uppercase tracking-wide transition active:scale-95">+ Add</button>`;
  } else {
    actionHtml = `
      <div class="inline-flex items-center brand-bg text-white rounded-xl overflow-hidden shadow-sm">
        <button onclick="updateQty('${item.id}', ${vIdx}, -1)" class="px-3 py-1.5 font-extrabold text-sm hover:bg-black/10">−</button>
        <span class="px-2.5 text-xs font-extrabold">${qty}</span>
        <button onclick="updateQty('${item.id}', ${vIdx}, 1)" class="px-3 py-1.5 font-extrabold text-sm hover:bg-black/10">+</button>
      </div>
    `;
  }

  return `
    <div class="bg-white rounded-2xl p-4 border border-slate-200/70 shadow-sm ${isSoldOut ? 'opacity-65' : ''}">
      <div class="flex items-start justify-between gap-3">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            ${dotHtml}
            ${item.badge ? `<span class="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-amber-100 text-amber-800">${esc(item.badge)}</span>` : ''}
          </div>
          <h3 class="text-[15px] font-bold text-slate-900 mt-1 leading-snug">${esc(item.name)}</h3>
          <div class="text-sm font-extrabold text-slate-800 mt-0.5">₹${activeVariant.price} ${hasMultipleVariants ? `<span class="text-xs font-medium text-slate-400">(${esc(activeVariant.label)})</span>` : ''}</div>
          ${item.description ? `<p class="text-xs text-slate-500 mt-1 leading-relaxed">${esc(item.description)}</p>` : ''}
          ${variantsHtml}
        </div>
        <div class="shrink-0 pt-1">
          ${actionHtml}
        </div>
      </div>
    </div>
  `;
}

function getCartStats() {
  let count = 0;
  let subtotal = 0;
  Object.values(cart).forEach(entry => {
    count += entry.qty;
    subtotal += entry.variant.price * entry.qty;
  });
  const minOrder = parseFloat(settings['Min Delivery Order'] || 0);
  const baseDelivery = parseFloat(settings['Delivery Charge'] || 0);
  const freeAbove = parseFloat(settings['Free Delivery Above'] || 0);

  let deliveryFee = 0;
  if (orderMode === 'delivery') {
    deliveryFee = (freeAbove > 0 && subtotal >= freeAbove) ? 0 : baseDelivery;
  }
  return { count, subtotal, deliveryFee, total: subtotal + deliveryFee, minOrder, freeAbove };
}

function updateFloatingCart() {
  const { count, subtotal } = getCartStats();
  const bar = document.getElementById('floatingCart');
  if (count === 0) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  document.getElementById('cartSummaryCount').textContent = `${count} ${count === 1 ? 'ITEM' : 'ITEMS'}`;
  document.getElementById('cartSummaryTotal').textContent = `₹${subtotal}`;
}

function openCheckout() {
  document.getElementById('checkoutModal').classList.remove('hidden');
  renderCheckoutModal();
}

function closeCheckout() {
  document.getElementById('checkoutModal').classList.add('hidden');
}

function setOrderMode(mode) {
  orderMode = mode;
  const dBtn = document.getElementById('modeDeliveryBtn');
  const tBtn = document.getElementById('modeTakeawayBtn');
  if (mode === 'delivery') {
    dBtn.className = 'py-2.5 rounded-lg text-xs font-extrabold transition bg-white text-slate-900 shadow-sm';
    tBtn.className = 'py-2.5 rounded-lg text-xs font-extrabold transition text-slate-500';
    document.getElementById('deliveryFields').classList.remove('hidden');
    document.getElementById('takeawayFields').classList.add('hidden');
  } else {
    tBtn.className = 'py-2.5 rounded-lg text-xs font-extrabold transition bg-white text-slate-900 shadow-sm';
    dBtn.className = 'py-2.5 rounded-lg text-xs font-extrabold transition text-slate-500';
    document.getElementById('takeawayFields').classList.remove('hidden');
    document.getElementById('deliveryFields').classList.add('hidden');
  }
  renderCheckoutModal();
}

function renderCheckoutModal() {
  const entries = Object.entries(cart);
  if (entries.length === 0) {
    closeCheckout();
    return;
  }

  const { subtotal, deliveryFee, total, minOrder, freeAbove } = getCartStats();

  const banner = document.getElementById('deliveryRuleBanner');
  if (orderMode === 'delivery') {
    if (minOrder > 0 && subtotal < minOrder) {
      banner.className = 'text-xs font-bold px-3.5 py-2.5 rounded-xl bg-red-50 text-red-700 border border-red-200';
      banner.textContent = `⚠️ Minimum order for Home Delivery is ₹${minOrder}. Add ₹${minOrder - subtotal} more (or switch to Takeaway).`;
    } else if (freeAbove > 0 && subtotal < freeAbove) {
      banner.className = 'text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200';
      banner.textContent = `💡 Add ₹${freeAbove - subtotal} more to unlock FREE Home Delivery!`;
    } else if (deliveryFee === 0) {
      banner.className = 'text-xs font-bold px-3.5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200';
      banner.textContent = `🎉 Yay! You unlocked FREE Home Delivery on this order.`;
    } else {
      banner.className = 'text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-amber-50 text-amber-800 border border-amber-200';
      banner.textContent = `🛵 Home Delivery charge of ₹${deliveryFee} applies.`;
    }
  } else {
    banner.className = 'text-xs font-semibold px-3.5 py-2.5 rounded-xl bg-blue-50 text-blue-800 border border-blue-200';
    banner.textContent = `🛍️ Self-Pickup from store — No minimum order or delivery charges.`;
  }

  document.getElementById('modalCartItems').innerHTML = entries.map(([key, e]) => `
    <div class="py-3 flex items-center justify-between gap-2">
      <div>
        <div class="text-xs font-bold text-slate-900">${esc(e.item.name)}</div>
        <div class="text-[11px] text-slate-500">${esc(e.variant.label)} • ₹${e.variant.price} × ${e.qty}</div>
      </div>
      <div class="flex items-center gap-2.5">
        <span class="text-xs font-extrabold text-slate-800">₹${e.variant.price * e.qty}</span>
        <div class="inline-flex items-center border border-slate-200 bg-white rounded-lg overflow-hidden">
          <button onclick="updateQty('${e.item.id}', ${e.variantIdx}, -1)" class="px-2 py-1 text-xs font-bold text-slate-600">−</button>
          <span class="px-2 text-xs font-extrabold">${e.qty}</span>
          <button onclick="updateQty('${e.item.id}', ${e.variantIdx}, 1)" class="px-2 py-1 text-xs font-bold brand-text">+</button>
        </div>
      </div>
    </div>
  `).join('');

  document.getElementById('billSubtotal').textContent = `₹${subtotal}`;
  const delRow = document.getElementById('billDeliveryRow');
  if (orderMode === 'delivery') {
    delRow.classList.remove('hidden');
    document.getElementById('billDelivery').textContent = deliveryFee === 0 ? 'FREE' : `₹${deliveryFee}`;
  } else {
    delRow.classList.add('hidden');
  }
  document.getElementById('billGrandTotal').textContent = `₹${total}`;
}

function captureGPS() {
  if (!navigator.geolocation) {
    alert('GPS is not supported on this browser.');
    return;
  }
  const btnText = document.getElementById('gpsBtnText');
  btnText.textContent = 'Fetching your location...';
  navigator.geolocation.getCurrentPosition(
    pos => {
      gpsLink = `https://maps.google.com/?q=${pos.coords.latitude},${pos.coords.longitude}`;
      btnText.textContent = '✅ GPS Location Attached!';
      document.getElementById('gpsBtn').className = 'w-full py-2.5 px-3 rounded-xl border border-emerald-300 bg-emerald-50 text-emerald-700 text-xs font-bold flex items-center justify-center gap-1.5';
    },
    () => {
      btnText.textContent = 'Location permission denied — Enter address manually';
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function sendWhatsAppOrder() {
  if (!isStoreOpen) {
    alert('Sorry, the store is currently closed.');
    return;
  }
  const { subtotal, deliveryFee, total, minOrder } = getCartStats();
  if (orderMode === 'delivery' && minOrder > 0 && subtotal < minOrder) {
    alert(`Minimum order for Home Delivery is ₹${minOrder}. Please add more items or select Takeaway.`);
    return;
  }

  const name = document.getElementById('custName').value.trim();
  const phone = document.getElementById('custPhone').value.trim();
  const address = document.getElementById('custAddress').value.trim();
  const pickupTime = document.getElementById('pickupTime').value;
  const note = document.getElementById('orderNote').value.trim();

  if (!name || !phone) {
    alert('Please enter your Name and Mobile Number.');
    return;
  }
  if (phone.replace(/\D/g, '').length < 10) {
    alert('Please enter a valid 10-digit mobile number.');
    return;
  }
  if (orderMode === 'delivery' && isLandmarkRequired && !address) {
    alert('Please enter your House / Flat Name, Area & Landmark.');
    return;
  }

  const shopWhatsApp = (settings['WhatsApp'] || '').replace(/\D/g, '');
  if (!shopWhatsApp) {
    alert('Shop WhatsApp number is not configured.');
    return;
  }

  const itemLines = Object.values(cart).map((e, i) =>
    `${i + 1}. *${e.item.name}* (${e.variant.label}) × ${e.qty} = ₹${e.variant.price * e.qty}`
  ).join('\n');

  let msg = `*NEW ORDER — ${(settings['Shop Name'] || 'FOODCART').toUpperCase()}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `*Order Type:* ${orderMode === 'delivery' ? '🛵 HOME DELIVERY' : '🛍️ TAKEAWAY (PICKUP)'}\n`;
  msg += `*Customer:* ${name}\n`;
  msg += `*Phone:* ${phone}\n`;

  if (orderMode === 'delivery') {
    if (address) msg += `*Address:* ${address}\n`;
    if (gpsLink) msg += `*GPS Pin:* ${gpsLink}\n`;
  } else {
    msg += `*Pickup Time:* ${pickupTime}\n`;
  }

  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `${itemLines}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `Item Total: ₹${subtotal}\n`;
  if (orderMode === 'delivery') {
    msg += `Delivery Fee: ${deliveryFee === 0 ? 'FREE' : '₹' + deliveryFee}\n`;
  }
  msg += `*GRAND TOTAL: ₹${total}*\n`;
  if (note) msg += `\n📝 *Note:* ${note}`;

  const url = `https://wa.me/${shopWhatsApp}?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');

  // Order sent: reset cart
  cart = {};
  saveCart();
  closeCheckout();
  renderMenu();
  updateFloatingCart();
}

init();