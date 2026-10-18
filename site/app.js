const KEYS = {
  shops: 'food-draw-shops-v1',
  settings: 'food-draw-settings-v1',
  history: 'food-draw-history-v1'
};

const DEFAULT_SETTINGS = {
  avoidRecent: true,
  avoidDays: 7,
  tagWeight: true,
  ratingFirst: true,
  preferredTags: ['常去', '招牌']
};

const CATEGORY_LABEL = {
  food: '吃饭',
  drink: '饮品'
};

const PIN_SVG = '<svg class="pin-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.2 1 5.9L12 17.1l-5.2 2.8 1-5.9-4.3-4.2 5.9-.9L12 3.6Z"/></svg>';
const CHECK_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';

const state = {
  shops: [],
  settings: Object.assign({}, DEFAULT_SETTINGS),
  history: [],
  category: 'food',
  addType: 'food',
  filter: 'all',
  expandedShopId: null,
  currentPosition: null,
  pendingLocation: null,
  searchResults: [],
  selectedTags: new Set(),
  spinning: false,
  result: null,
  pickedShop: null,
  tickTimer: null,
  drawTimer: null
};

const el = {};

function $(id) {
  return document.getElementById(id);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (err) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('本地存储写入失败', err);
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function stars(rating) {
  const value = Math.max(0, Math.min(5, Number(rating) || 0));
  const full = Math.round(value);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}

function distanceText(distance) {
  if (distance == null || distance === '') return '';
  const value = Number(distance);
  if (Number.isNaN(value)) return '';
  return value < 1000 ? Math.round(value) + 'm' : (value / 1000).toFixed(1) + 'km';
}

function haversine(from, to) {
  const toRad = (value) => (value * Math.PI) / 180;
  const radius = 6371000;
  const dLat = toRad(to.lat - from.lat);
  const dLng = toRad(to.lng - from.lng);
  const a = Math.pow(Math.sin(dLat / 2), 2)
    + Math.cos(toRad(from.lat)) * Math.cos(toRad(to.lat))
    * Math.pow(Math.sin(dLng / 2), 2);
  return Math.round(2 * radius * Math.asin(Math.sqrt(a)));
}

function parseDishes(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 12);
  }
  return String(value || '')
    .split(/[,，、;；\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function normalizeShop(shop) {
  const location = shop.location || {};
  return {
    id: shop.id || uid(),
    name: String(shop.name || '').trim(),
    type: shop.type === 'drink' ? 'drink' : 'food',
    address: String(shop.address || ''),
    lat: shop.lat == null && location.latitude == null ? null : Number(shop.lat != null ? shop.lat : location.latitude),
    lng: shop.lng == null && location.longitude == null ? null : Number(shop.lng != null ? shop.lng : location.longitude),
    distance: shop.distance == null ? null : Number(shop.distance),
    rating: shop.rating == null ? null : Number(shop.rating),
    tags: Array.isArray(shop.tags) ? shop.tags.filter(Boolean).map(String) : [],
    dishes: parseDishes(shop.dishes),
    note: String(shop.note || ''),
    pinned: !!shop.pinned,
    lastEatenAt: shop.lastEatenAt || null,
    createdAt: shop.createdAt || Date.now()
  };
}

function loadState() {
  const shops = readJSON(KEYS.shops, []);
  const settings = readJSON(KEYS.settings, {});
  const history = readJSON(KEYS.history, []);

  state.shops = Array.isArray(shops)
    ? shops.map(normalizeShop).filter((shop) => shop.name)
    : [];
  state.settings = Object.assign(
    {},
    DEFAULT_SETTINGS,
    settings && typeof settings === 'object' ? settings : {}
  );
  if (!Array.isArray(state.settings.preferredTags)) {
    state.settings.preferredTags = DEFAULT_SETTINGS.preferredTags.slice();
  }
  state.history = Array.isArray(history) ? history : [];
}

function saveShops() {
  writeJSON(KEYS.shops, state.shops);
}

function saveSettings() {
  writeJSON(KEYS.settings, state.settings);
}

function saveHistory() {
  writeJSON(KEYS.history, state.history);
}

function showToast(message) {
  const node = el.toast;
  node.textContent = message;
  node.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => node.classList.remove('show'), 2200);
}

function renderDeck() {
  const label = CATEGORY_LABEL[state.category];
  const categoryShops = state.shops.filter((shop) => shop.type === state.category);
  const eligible = getEligible();

  if (el.deckBadge) el.deckBadge.textContent = label;
  if (el.deckBack1) {
    el.deckBack1.textContent = categoryShops[0] ? categoryShops[0].name : '还没有收藏';
  }
  if (el.deckBack2) {
    el.deckBack2.textContent = categoryShops[1] ? categoryShops[1].name : '等你添加';
  }
  if (el.deckHint) {
    el.deckHint.textContent = eligible.pool.length
      ? '从 ' + eligible.pool.length + ' 家收藏里抽一张'
      : (categoryShops.length ? '最近都吃过了，去添加新店' : '先添加几家收藏');
  }
}

function openSheet(name) {
  closeSheet();
  const sheet = $('screen-' + name);
  if (!sheet) return;

  sheet.hidden = false;
  el.sheetBackdrop.hidden = false;
  document.body.classList.add('sheet-open');

  requestAnimationFrame(() => {
    sheet.classList.add('open');
    el.sheetBackdrop.classList.add('open');
  });

  if (name === 'list') renderList();
  if (name === 'me') {
    renderHistory();
    syncSettingsUI();
  }
  if (name === 'add') {
    setTimeout(() => el.placeSearch.focus(), 360);
  }
}

function closeSheet() {
  document.querySelectorAll('.sheet.open').forEach((sheet) => {
    sheet.classList.remove('open');
    setTimeout(() => {
      if (!sheet.classList.contains('open')) sheet.hidden = true;
    }, 320);
  });

  if (el.sheetBackdrop) {
    el.sheetBackdrop.classList.remove('open');
    setTimeout(() => {
      if (!document.querySelector('.sheet.open')) el.sheetBackdrop.hidden = true;
    }, 320);
  }

  document.body.classList.remove('sheet-open');
}

function setCategory(category) {
  if (state.spinning) return;
  state.category = category;
  document.querySelectorAll('#catSeg .seg-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.cat === category);
  });
  $('catSeg').classList.toggle('drink', category === 'drink');
  $('screen-draw').classList.toggle('drink', category === 'drink');
  el.drawTitle.textContent = category === 'food' ? '今天吃什么？' : '今天喝什么？';
  state.result = null;
  el.resultCard.innerHTML = '';
  $('screen-draw').classList.remove('has-result');
  el.ticker.textContent = '';
  updateDrawSub();
}

function setAddType(type) {
  state.addType = type;
  document.querySelectorAll('#typeSeg .seg-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.type === type);
  });
  $('typeSeg').classList.toggle('drink', type === 'drink');
  $('screen-add').classList.toggle('drink', type === 'drink');
  state.searchResults = [];
  el.placeResults.innerHTML = '';
}

function getEligible() {
  const avoidDays = state.settings.avoidRecent ? (state.settings.avoidDays || 7) : 0;
  const pool = [];
  let excluded = 0;

  state.shops.forEach((shop) => {
    if (shop.type !== state.category) return;
    const days = shop.lastEatenAt
      ? (Date.now() - shop.lastEatenAt) / 86400000
      : Infinity;

    if (avoidDays > 0 && days <= avoidDays) {
      excluded += 1;
      return;
    }
    pool.push(shop);
  });

  return { pool, excluded };
}

function weightedPick(pool) {
  const scored = pool.map((shop) => {
    let score = state.settings.ratingFirst ? (Number(shop.rating) || 0) * 2 : 0;
    const preferred = state.settings.tagWeight
      && (shop.tags || []).some((tag) => state.settings.preferredTags.indexOf(tag) > -1);
    if (preferred) score += 3;
    return { shop, score: Math.max(0.01, score) };
  });

  const total = scored.reduce((sum, item) => sum + item.score, 0);
  let cursor = Math.random() * total;

  for (let i = 0; i < scored.length; i += 1) {
    cursor -= scored[i].score;
    if (cursor <= 0) return scored[i].shop;
  }

  return scored[scored.length - 1].shop;
}

function updateDrawSub() {
  const label = CATEGORY_LABEL[state.category];
  const eligible = getEligible();
  const total = state.shops.filter((shop) => shop.type === state.category).length;
  let text = '从 ' + eligible.pool.length + ' 家「' + label + '」中综合抽取';

  if (eligible.excluded) {
    text += ' · 已避开最近吃过的 ' + eligible.excluded + ' 家';
  }
  if (!eligible.pool.length && total) {
    text = '最近都吃过了，换一类、添加新店，或到「我的」关闭避让';
  }

  el.drawSub.textContent = text;
  el.drawEmpty.hidden = total !== 0;
  renderDeck();
}

function startDraw() {
  if (state.spinning) return;
  $('screen-draw').classList.remove('has-result');

  const eligible = getEligible();
  if (!eligible.pool.length) {
    showToast(state.shops.some((shop) => shop.type === state.category)
      ? '最近都吃过了，换一类或去添加新店'
      : '先去添加几家收藏吧');
    return;
  }

  const picked = weightedPick(eligible.pool);
  state.spinning = true;
  state.result = null;
  el.resultCard.innerHTML = '';
  el.deck.classList.add('shuffling');
  el.ticker.textContent = eligible.pool[0].name;

  let index = 0;
  state.tickTimer = setInterval(() => {
    index += 1;
    el.ticker.textContent = eligible.pool[index % eligible.pool.length].name;
  }, 90);

  state.drawTimer = setTimeout(() => {
    clearInterval(state.tickTimer);
    state.spinning = false;
    el.deck.classList.remove('shuffling');
    el.ticker.textContent = '';
    state.result = picked;
    renderResult(picked);
    if (navigator.vibrate) navigator.vibrate(15);
  }, 1250);
}

function renderResult(shop) {
  $('screen-draw').classList.add('has-result');
  const distance = distanceText(shop.distance);
  const tags = (shop.tags || [])
    .map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>')
    .join('');
  const dishes = (shop.dishes || [])
    .map((dish) => '<span class="dish-chip">' + escapeHtml(dish) + '</span>')
    .join('');
  const note = shop.note
    ? '<div class="r-note">备注：' + escapeHtml(shop.note) + '</div>'
    : '';

  el.resultCard.innerHTML = `
    <div class="result-card">
      <div class="r-reveal">抽中了</div>
      <div class="r-top">
        <span class="cat-badge">${CATEGORY_LABEL[shop.type]}</span>
        <span class="r-dist">${distance}</span>
      </div>
      <h3 class="r-name">${escapeHtml(shop.name)}</h3>
      <div class="r-rating">
        <span>${stars(shop.rating)}</span>
        <span class="num">${shop.rating == null ? '—' : shop.rating}</span>
      </div>
      <div class="r-tags">${tags}</div>
      <div class="r-addr">${escapeHtml(shop.address || '')}${shop.lat != null && shop.lng != null ? ' <button class="nav-link" data-result-action="navigate" type="button">导航</button>' : ''}</div>
      ${dishes ? '<div class="r-dishes"><span class="r-dish-label">招牌菜</span>' + dishes + '</div>' : ''}
      ${note}
      <div class="r-btns">
        <button class="btn primary" data-result-action="picked" type="button">就它了 ${CHECK_SVG}</button>
        <button class="btn ghost" data-result-action="again" type="button">再抽一次</button>
      </div>
    </div>
  `;
}

function pickedCurrent() {
  if (!state.result) return;

  const shop = state.shops.find((item) => item.id === state.result.id);
  if (!shop) return;

  shop.lastEatenAt = Date.now();
  saveShops();
  state.history.unshift({
    name: shop.name,
    type: shop.type,
    at: shop.lastEatenAt
  });
  state.history = state.history.slice(0, 50);
  saveHistory();

  state.result = null;
  el.resultCard.innerHTML = '';
  $('screen-draw').classList.remove('has-result');
  renderList();
  updateDrawSub();
  renderHistory();
  showPickedView(shop);
  if (navigator.vibrate) navigator.vibrate([20, 30, 20]);
}

function showPickedView(shop) {
  state.pickedShop = shop;
  const canNavigate = shop.lat != null && shop.lng != null;

  el.pickedView.hidden = false;
  el.pickedView.classList.toggle('drink', shop.type === 'drink');
  el.pickedName.textContent = shop.name;
  el.pickedAddress.textContent = shop.address || '地址待补充';
  el.pickedDishes.innerHTML = (shop.dishes && shop.dishes.length)
    ? shop.dishes.map((dish) => '<span class="dish-chip">' + escapeHtml(dish) + '</span>').join('')
    : '<span class="dish-empty">还没有记录招牌菜</span>';
  el.pickedNavigateBtn.disabled = !canNavigate;
  el.pickedNavigateBtn.textContent = canNavigate ? '导航出发' : '暂无坐标';

  document.body.classList.add('picked-open');
  requestAnimationFrame(() => el.pickedView.classList.add('open'));
}

function closePickedView() {
  el.pickedView.classList.remove('open');
  document.body.classList.remove('picked-open');
  setTimeout(() => {
    el.pickedView.hidden = true;
    state.pickedShop = null;
    $('screen-draw').classList.remove('has-result');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, 280);
}

function shopCardHtml(shop) {
  const tags = (shop.tags || [])
    .map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>')
    .join('');
  const rating = shop.rating == null ? '—' : shop.rating;
  const distance = distanceText(shop.distance);
  const expanded = state.expandedShopId === shop.id;
  const dishes = (shop.dishes || [])
    .map((dish) => '<span class="dish-chip">' + escapeHtml(dish) + '</span>')
    .join('');
  const preview = shop.dishes && shop.dishes.length
    ? '招牌：' + shop.dishes.slice(0, 3).map((dish) => escapeHtml(dish)).join('、')
    : '点击展开店铺详情';

  return `
    <article class="shop-card ${expanded ? 'expanded' : ''}" data-shop-id="${escapeHtml(shop.id)}">
      <div class="shop-head">
        <div class="shop-name-wrap">
          ${shop.pinned ? PIN_SVG : ''}
          <span class="shop-name">${escapeHtml(shop.name)}</span>
        </div>
        <div class="shop-right">
          <span class="shop-dist">${distance}</span>
          <span class="mini-badge ${shop.type}">${shop.type === 'food' ? '吃' : '饮'}</span>
          <span class="shop-chevron">›</span>
        </div>
      </div>
      <div class="shop-preview">${preview}</div>
      <div class="shop-detail" ${expanded ? '' : 'hidden'}>
        <div class="shop-addr">${escapeHtml(shop.address || '')}</div>
        <div class="shop-meta">
          <span class="shop-stars">${stars(shop.rating)}</span>
          <span class="num">${rating}</span>
          ${tags}
        </div>
        ${dishes
          ? '<div class="dish-block"><div class="dish-title">招牌菜 / 推荐菜</div><div class="dish-row">' + dishes + '</div></div>'
          : '<div class="dish-empty">还没有记录招牌菜，点下方“编辑招牌菜”补充</div>'}
        ${shop.note ? '<div class="shop-note">备注：' + escapeHtml(shop.note) + '</div>' : ''}
        <div class="shop-actions">
          ${shop.lat != null && shop.lng != null ? '<button class="action" data-action="navigate" data-id="' + escapeHtml(shop.id) + '" type="button">导航</button>' : ''}
          <button class="action" data-action="edit-dishes" data-id="${escapeHtml(shop.id)}" type="button">编辑招牌菜</button>
          <button class="action" data-action="pin" data-id="${escapeHtml(shop.id)}" type="button">${shop.pinned ? '取消置顶' : '置顶'}</button>
          <button class="action danger" data-action="delete" data-id="${escapeHtml(shop.id)}" type="button">删除</button>
        </div>
      </div>
    </article>
  `;
}

function renderList() {
  const list = state.shops
    .filter((shop) => state.filter === 'all' || shop.type === state.filter)
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.createdAt - a.createdAt;
    });

  el.shopCount.textContent = state.shops.length + ' 家';
  el.shopList.innerHTML = list.map(shopCardHtml).join('');
  el.listEmpty.hidden = list.length !== 0;
}

function setFilter(filter) {
  state.filter = filter;
  document.querySelectorAll('#filterRow .filter').forEach((item) => {
    item.classList.toggle('active', item.dataset.filter === filter);
  });
  renderList();
}

function togglePin(id) {
  const shop = state.shops.find((item) => item.id === id);
  if (!shop) return;
  shop.pinned = !shop.pinned;
  saveShops();
  renderList();
}

function editDishes(id) {
  const shop = state.shops.find((item) => item.id === id);
  if (!shop) return;

  const input = window.prompt(
    '输入招牌菜 / 推荐菜，用逗号分隔',
    (shop.dishes || []).join('、')
  );
  if (input == null) return;

  shop.dishes = parseDishes(input);
  saveShops();
  renderList();
  showToast(shop.dishes.length ? '招牌菜已更新' : '已清空招牌菜');
}

function deleteShop(id) {
  const shop = state.shops.find((item) => item.id === id);
  if (!shop) return;
  if (!window.confirm('确定删除「' + shop.name + '」吗？')) return;

  state.shops = state.shops.filter((item) => item.id !== id);
  if (state.expandedShopId === id) state.expandedShopId = null;
  if (state.result && state.result.id === id) {
    state.result = null;
    el.resultCard.innerHTML = '';
    $('screen-draw').classList.remove('has-result');
  }
  saveShops();
  renderList();
  updateDrawSub();
  showToast('已删除');
}

function renderHistory() {
  if (!state.history.length) {
    el.historyList.innerHTML = '<div class="history-item"><span class="history-meta">还没有抽签记录</span></div>';
    return;
  }

  el.historyList.innerHTML = state.history.slice(0, 8).map((item) => `
    <div class="history-item">
      <span class="history-name">${escapeHtml(item.name)}</span>
      <span class="history-meta">${CATEGORY_LABEL[item.type] || ''} · ${timeAgo(item.at)}</span>
    </div>
  `).join('');
}

function timeAgo(timestamp) {
  if (!timestamp) return '—';
  const days = Math.floor((Date.now() - timestamp) / 86400000);
  if (days <= 0) return '今天';
  if (days === 1) return '昨天';
  return days + ' 天前';
}

function syncSettingsUI() {
  el.setAvoid.checked = !!state.settings.avoidRecent;
  el.setTag.checked = !!state.settings.tagWeight;
  el.setRating.checked = !!state.settings.ratingFirst;
}

function setLocText(text) {
  el.locText.textContent = text;
  el.addLocText.textContent = text;
}

function locate() {
  setLocText('定位中…');

  if (!navigator.geolocation) {
    setLocText('不支持定位');
    return Promise.reject(new Error('不支持定位'));
  }

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        state.currentPosition = wgs84ToGcj02(
          position.coords.latitude,
          position.coords.longitude
        );
        setLocText('已定位');
        refreshDistances();
        updateGeoNote();
        resolve(state.currentPosition);
      },
      () => {
        setLocText('未定位');
        updateGeoNote();
        reject(new Error('定位失败'));
      },
      {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 600000
      }
    );
  });
}

function refreshDistances() {
  if (!state.currentPosition) return;

  state.shops = state.shops.map((shop) => {
    if (shop.lat == null || shop.lng == null) return shop;
    return Object.assign({}, shop, {
      distance: haversine(state.currentPosition, { lat: shop.lat, lng: shop.lng })
    });
  });
  saveShops();
  renderList();
}

function updateGeoNote() {
  if (!state.pendingLocation) {
    el.geoNote.hidden = true;
    return;
  }

  let text = '已选择地图地点';
  if (state.currentPosition) {
    text += ' · 距离约 ' + distanceText(haversine(state.currentPosition, state.pendingLocation));
  } else {
    text += ' · 未定位，无法计算距离';
  }

  el.geoNoteText.textContent = text;
  el.geoNote.hidden = false;
}

function openAmapNavigation(location, name, address) {
  if (!location || location.lat == null || location.lng == null) {
    showToast('这个地点没有坐标，暂时无法导航');
    return;
  }

  const to = location.lng + ',' + location.lat + ',' + encodeURIComponent(name || '目的地');
  const url = 'https://uri.amap.com/navigation?to=' + to
    + '&mode=car&src=eat-what&coordinate=gaode&callnative=1';
  const win = window.open(url, '_blank', 'noopener');
  if (!win) window.location.href = url;
}

function navigateToSelected() {
  if (!state.pendingLocation) {
    showToast('请先选择地点');
    return;
  }

  openAmapNavigation(
    state.pendingLocation,
    el.shopName.value.trim() || '目的地',
    el.shopAddress.value.trim()
  );
}

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

function wgs84ToGcj02(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng };

  const a = 6378245.0;
  const ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);

  return { lat: lat + dLat, lng: lng + dLng };
}

function jsonpRequest(url, timeout) {
  return new Promise((resolve, reject) => {
    const callbackName = '__tmap_cb_' + Date.now() + '_' + Math.floor(Math.random() * 100000);
    const script = document.createElement('script');
    let settled = false;
    let timer = null;

    function cleanup() {
      if (timer) clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      try {
        delete window[callbackName];
      } catch (err) {
        window[callbackName] = undefined;
      }
    }

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('腾讯地图请求超时'));
    }, timeout || 10000);

    window[callbackName] = (data) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('腾讯地图请求失败'));
    };

    script.src = url + (url.indexOf('?') > -1 ? '&' : '?')
      + 'output=jsonp&callback=' + callbackName;
    document.head.appendChild(script);
  });
}

function formatTencentError(res) {
  const status = res && res.status;
  if (status === 110 || status === 111 || status === 112) {
    return '腾讯地图 Key 未授权当前域名，请检查域名白名单';
  }
  if (status === 120) return '腾讯地图今日搜索额度已用完';
  return (res && res.message) || '腾讯地图搜索失败';
}

async function tencentSearch(keyword, center) {
  const key = window.APP_CONFIG && window.APP_CONFIG.tencentMapKey;
  if (!key) throw new Error('请先配置腾讯地图 Key');

  const nearby = 'nearby(' + center.lat + ',' + center.lng + ',1000)';
  const base = 'https://apis.map.qq.com/ws/place/v1/search'
    + '?keyword=' + encodeURIComponent(keyword)
    + '&boundary=' + encodeURIComponent(nearby)
    + '&page_size=20'
    + '&key=' + encodeURIComponent(key);

  const res = await jsonpRequest(base);
  if (!res || res.status !== 0) {
    throw new Error(formatTencentError(res));
  }

  let data = res.data || [];

  // 1 公里内没有结果时，反查城市，再按城市范围搜一次
  if (!data.length) {
    try {
      const geoUrl = 'https://apis.map.qq.com/ws/geocoder/v1/'
        + '?location=' + center.lat + ',' + center.lng
        + '&key=' + encodeURIComponent(key);
      const geo = await jsonpRequest(geoUrl);
      const result = geo && geo.result;
      const city = result && (
        (result.ad_info && result.ad_info.city)
        || (result.address_component && result.address_component.city)
      );

      if (city) {
        const region = 'region(' + city + ',0)';
        const regionUrl = 'https://apis.map.qq.com/ws/place/v1/search'
          + '?keyword=' + encodeURIComponent(keyword)
          + '&boundary=' + encodeURIComponent(region)
          + '&page_size=20'
          + '&key=' + encodeURIComponent(key);
        const regionRes = await jsonpRequest(regionUrl);
        if (regionRes && regionRes.status === 0) {
          data = regionRes.data || [];
        }
      }
    } catch (err) {
      // 城市级兜底失败时保留空结果，让用户手动填写
    }
  }

  return data.map((item) => {
    const location = item.location || {};
    const lat = Number(location.lat);
    const lng = Number(location.lng);
    return {
      name: item.title || '未命名地点',
      address: item.address || '',
      lat,
      lng,
      distance: lat && lng ? haversine(center, { lat, lng }) : null,
      rating: null,
      cost: null
    };
  }).filter((item) => item.name && item.lat && item.lng)
    .sort((a, b) => {
      const left = a.distance == null ? Infinity : a.distance;
      const right = b.distance == null ? Infinity : b.distance;
      return left - right;
    });
}

let amapPromise = null;

function loadAmap() {
  if (window.AMap && window.AMap.PlaceSearch) return Promise.resolve();
  if (amapPromise) return amapPromise;

  const config = window.APP_CONFIG || {};
  if (!config.amapKey) {
    return Promise.reject(new Error('请先配置高德 JS API Key'));
  }

  if (config.amapSecurityCode) {
    window._AMapSecurityConfig = {
      securityJsCode: config.amapSecurityCode
    };
  }

  amapPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://webapi.amap.com/maps?v=2.0&key='
      + encodeURIComponent(config.amapKey)
      + '&plugin=AMap.PlaceSearch';
    script.async = true;
    script.onload = () => {
      if (window.AMap && window.AMap.PlaceSearch) {
        resolve();
      } else {
        amapPromise = null;
        reject(new Error('高德 JS API 加载失败'));
      }
    };
    script.onerror = () => {
      amapPromise = null;
      reject(new Error('高德 JS API 加载失败'));
    };
    document.head.appendChild(script);
  });

  return amapPromise;
}

function amapSearch(keyword, center) {
  return loadAmap().then(() => new Promise((resolve, reject) => {
    const search = new AMap.PlaceSearch({
      pageSize: 20,
      pageIndex: 1,
      extensions: 'all'
    });

    search.searchNearBy(keyword, [center.lng, center.lat], 3000, (status, result) => {
      if (status === 'complete' && result && result.poiList) {
        const pois = (result.poiList.pois || []).map((poi) => {
          const loc = poi.location || {};
          const lat = Number(loc.lat);
          const lng = Number(loc.lng);
          let distance = Number(poi.distance);
          if (!distance && lat && lng) {
            distance = haversine(center, { lat, lng });
          }
          return {
            name: poi.name || '未命名地点',
            address: poi.address || '',
            lat,
            lng,
            distance,
            rating: poi.biz_ext && poi.biz_ext.rating
              ? Number(poi.biz_ext.rating)
              : null,
            cost: poi.biz_ext && poi.biz_ext.cost
              ? Number(poi.biz_ext.cost)
              : null
          };
        }).filter((poi) => poi.name && poi.lat && poi.lng);

        pois.sort((a, b) => {
          const left = a.distance == null ? Infinity : a.distance;
          const right = b.distance == null ? Infinity : b.distance;
          return left - right;
        });
        resolve(pois);
      } else if (status === 'no_data') {
        resolve([]);
      } else {
        reject(new Error(result && result.info ? result.info : '高德搜索失败'));
      }
    });
  }));
}

async function searchPlaces() {
  if (el.placeSearchBtn.disabled) return;
  const keyword = el.placeSearch.value.trim();
  if (!keyword) {
    showToast('请输入店名或关键词');
    el.placeSearch.focus();
    return;
  }

  const config = window.APP_CONFIG || {};
  if (!config.amapKey && !config.tencentMapKey) {
    showToast('请先配置地图 Key');
    return;
  }
  if (!state.currentPosition) {
    showToast('请先允许定位，再搜索附近店铺');
    locate().catch(() => {});
    return;
  }

  el.placeSearchBtn.disabled = true;
  el.placeSearchBtn.textContent = '搜索中';
  el.placeResults.innerHTML = '<div class="hint">正在搜索附近地点…</div>';

  try {
    const data = config.amapKey
      ? await amapSearch(keyword, state.currentPosition)
      : await tencentSearch(keyword, state.currentPosition);
    state.searchResults = data;
    renderSearchResults();
  } catch (err) {
    state.searchResults = [];
    const message = err && err.message ? err.message : '腾讯地图搜索失败';
    el.placeResults.innerHTML = '<div class="hint">'
      + escapeHtml(message) + '，或手动填写下方信息。</div>';
  } finally {
    el.placeSearchBtn.disabled = false;
    el.placeSearchBtn.textContent = '搜索';
  }
}

function renderSearchResults() {
  if (!state.searchResults.length) {
    el.placeResults.innerHTML = '<div class="hint">没有搜到相关地点，可以手动填写下方信息。</div>';
    return;
  }

  el.placeResults.innerHTML = state.searchResults.map((item, index) => `
    <div class="place-result">
      <div class="place-info">
        <div class="place-name">${escapeHtml(item.name)}</div>
        <div class="place-addr">${escapeHtml(item.address)}${item.distance ? ' · ' + distanceText(item.distance) : ''}</div>
      </div>
      <button class="choose-btn" data-index="${index}" type="button">选择</button>
    </div>
  `).join('');
}

async function recommendNearby() {
  const config = window.APP_CONFIG || {};
  if (!config.amapKey && !config.tencentMapKey) {
    showToast('请先配置地图 Key');
    return;
  }

  if (!state.currentPosition) {
    try {
      await locate();
    } catch (err) {
      showToast('定位失败，请允许位置权限后重试');
      return;
    }
  }

  const keyword = state.addType === 'drink' ? '饮品' : '美食';
  el.recommendBtn.disabled = true;
  el.recommendLabel.textContent = '正在找…';
  el.placeResults.innerHTML = '<div class="hint">正在按评分和距离找附近的店…</div>';

  try {
    const data = config.amapKey
      ? await amapSearch(keyword, state.currentPosition)
      : await tencentSearch(keyword, state.currentPosition);
    const savedNames = new Set(state.shops.map((shop) => shop.name));
    const list = data
      .filter((item) => !savedNames.has(item.name))
      .sort((a, b) => {
        const ar = Number(a.rating) || 0;
        const br = Number(b.rating) || 0;
        if (br !== ar) return br - ar;
        const ad = a.distance == null ? Infinity : a.distance;
        const bd = b.distance == null ? Infinity : b.distance;
        return ad - bd;
      })
      .slice(0, 12);

    state.searchResults = list;
    renderRecommendations();
  } catch (err) {
    const message = err && err.message ? err.message : '附近推荐失败';
    el.placeResults.innerHTML = '<div class="hint">'
      + escapeHtml(message) + '，也可以手动填写。</div>';
  } finally {
    el.recommendBtn.disabled = false;
    el.recommendLabel.textContent = '附近推荐';
  }
}

function renderRecommendations() {
  if (!state.searchResults.length) {
    el.placeResults.innerHTML = '<div class="hint">附近没有新的店了，换个类型或手动搜索。</div>';
    return;
  }

  el.placeResults.innerHTML = state.searchResults.map((item, index) => `
    <div class="place-result recommend">
      <div class="place-info">
        <div class="place-name">${escapeHtml(item.name)}</div>
        <div class="place-addr">${escapeHtml(item.address || '')}${item.distance ? ' · ' + distanceText(item.distance) : ''}</div>
        <div class="place-meta">
          ${item.rating ? '★ ' + Number(item.rating).toFixed(1) : '暂无评分'}
          ${item.cost ? '<span class="cost"> · 人均 ¥' + item.cost + '</span>' : ''}
        </div>
      </div>
      <button class="choose-btn" data-recommend-index="${index}" type="button">加入</button>
    </div>
  `).join('');
}

async function addRecommended(index) {
  const item = state.searchResults[index];
  if (!item) return;

  if (state.shops.some((shop) => shop.name === item.name)) {
    showToast('这家已经收藏过了');
    return;
  }

  state.shops.push(normalizeShop({
    id: uid(),
    name: item.name,
    type: state.addType,
    address: item.address || '',
    lat: item.lat,
    lng: item.lng,
    distance: item.distance,
    rating: item.rating == null ? null : item.rating,
    tags: ['推荐'],
    dishes: [],
    note: '',
    pinned: false,
    lastEatenAt: null,
    createdAt: Date.now()
  }));

  saveShops();
  updateDrawSub();
  renderList();
  showToast('已加入收藏');

  const button = el.placeResults.querySelector('[data-recommend-index="' + index + '"]');
  if (button) {
    button.textContent = '已加入';
    button.disabled = true;
    button.classList.add('added');
  }
}

function selectPlace(index) {
  const item = state.searchResults[index];
  if (!item) return;

  el.shopName.value = item.name;
  el.shopAddress.value = item.address;
  el.shopRating.value = '';
  state.pendingLocation = { lat: item.lat, lng: item.lng };
  updateGeoNote();
  el.placeResults.innerHTML = '';
  showToast('已选择地点，可补充评分后添加');
}

function resetAddForm() {
  el.placeSearch.value = '';
  el.shopName.value = '';
  el.shopAddress.value = '';
  el.shopRating.value = '';
  el.shopDishes.value = '';
  el.placeResults.innerHTML = '';
  state.searchResults = [];
  state.pendingLocation = null;
  state.selectedTags.clear();
  document.querySelectorAll('#tagRow .tag-chip').forEach((button) => {
    button.classList.remove('active');
  });
  el.geoNote.hidden = true;
}

function addShop() {
  const name = el.shopName.value.trim();
  const address = el.shopAddress.value.trim();
  if (!name) {
    showToast('请先填写店名');
    el.shopName.focus();
    return;
  }

  let rating = parseFloat(el.shopRating.value);
  rating = Number.isNaN(rating) ? null : Math.max(0, Math.min(5, rating));

  const pending = state.pendingLocation;
  const distance = pending && state.currentPosition
    ? haversine(state.currentPosition, pending)
    : null;

  const newShop = normalizeShop({
    id: uid(),
    name,
    type: state.addType,
    address,
    lat: pending ? pending.lat : null,
    lng: pending ? pending.lng : null,
    distance,
    rating,
    tags: Array.from(state.selectedTags),
    dishes: parseDishes(el.shopDishes.value),
    note: '',
    pinned: false,
    lastEatenAt: null,
    createdAt: Date.now()
  });

  state.shops.push(newShop);
  state.expandedShopId = newShop.id;

  saveShops();
  resetAddForm();
  setFilter('all');
  updateDrawSub();
  showToast('已添加到收藏');
  openSheet('list');
}

function exportData() {
  const data = {
    shops: state.shops,
    settings: state.settings,
    history: state.history,
    exportedAt: new Date().toISOString()
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'food-draw-backup-' + new Date().toISOString().slice(0, 10) + '.json';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('已导出备份');
}

async function importData(file) {
  if (!file) return;

  try {
    const data = JSON.parse(await file.text());
    const shops = Array.isArray(data) ? data : data.shops;
    if (!Array.isArray(shops)) throw new Error('invalid data');
    if (!window.confirm('导入会替换当前收藏，确定吗？')) return;

    state.shops = shops.map(normalizeShop).filter((shop) => shop.name);
    if (data.settings) {
      state.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings);
    }
    if (Array.isArray(data.history)) {
      state.history = data.history;
    }

    saveShops();
    saveSettings();
    saveHistory();
    setFilter('all');
    updateDrawSub();
    renderHistory();
    syncSettingsUI();
    showToast('导入成功');
  } catch (err) {
    showToast('导入失败，请检查文件格式');
  } finally {
    el.importFile.value = '';
  }
}

function loadDemoData(force) {
  const demos = [
    { name: '老王牛肉面', type: 'food', address: '科技园南路 12 号', rating: 4.6, tags: ['面食', '常去'], dishes: ['牛肉面', '凉拌黄瓜'], lastDays: 5 },
    { name: '蜀香火锅', type: 'food', address: '海岸城 3 层 305', rating: 4.8, tags: ['火锅', '聚餐'], dishes: ['毛肚', '肥牛', '虾滑'], lastDays: 2 },
    { name: '轻食沙拉', type: 'food', address: '软件产业基地 2 栋', rating: 4.3, tags: ['轻食', '健康'], dishes: ['鸡胸沙拉', '牛油果沙拉'], lastDays: null },
    { name: '日式烧肉', type: 'food', address: '万象天地 B1', rating: 4.7, tags: ['烧肉', '约会'], dishes: ['牛舌', '横膈膜'], lastDays: null },
    { name: '兰州拉面', type: 'food', address: '科苑北路 11 号', rating: 4.2, tags: ['面食', '平价'], dishes: ['牛肉拉面', '小菜'], lastDays: null },
    { name: '一点点', type: 'drink', address: '科苑路 8 号', rating: 4.5, tags: ['奶茶', '外卖'], dishes: ['波霸奶茶', '四季春'], lastDays: 6 },
    { name: '喜茶', type: 'drink', address: '海岸城 1 层', rating: 4.7, tags: ['奶茶', '招牌'], dishes: ['多肉葡萄', '芝芝莓莓'], lastDays: 1 },
    { name: '瑞幸咖啡', type: 'drink', address: '软件产业基地 1 栋', rating: 4.4, tags: ['咖啡', '提神'], dishes: ['生椰拿铁', '美式'], lastDays: null },
    { name: '椰子冰沙', type: 'drink', address: '深大西门', rating: 4.2, tags: ['甜品', '清爽'], dishes: ['椰子冰沙', '芒果冰'], lastDays: null },
    { name: '蜜雪冰城', type: 'drink', address: '科苑南路 3 号', rating: 4.1, tags: ['奶茶', '平价'], dishes: ['冰鲜柠檬水', '圣代'], lastDays: null }
  ];

  if (!force && state.shops.length && !window.confirm('已有收藏，继续会追加示例数据，确定吗？')) return;

  const existing = new Set(state.shops.map((shop) => shop.name));
  let added = 0;

  demos.forEach((demo) => {
    if (existing.has(demo.name)) return;
    state.shops.push(normalizeShop({
      id: uid(),
      name: demo.name,
      type: demo.type,
      address: demo.address,
      rating: demo.rating,
      tags: demo.tags,
      dishes: demo.dishes,
      lastEatenAt: demo.lastDays == null ? null : Date.now() - demo.lastDays * 86400000,
      createdAt: Date.now() - Math.random() * 100000
    }));
    added += 1;
  });

  saveShops();
  renderList();
  updateDrawSub();
  showToast(added ? '已载入 ' + added + ' 家示例' : '示例数据已存在');
}

function clearAll() {
  if (!window.confirm('确定清空所有收藏、历史和设置吗？')) return;

  state.shops = [];
  state.history = [];
  state.settings = Object.assign({}, DEFAULT_SETTINGS);
  saveShops();
  saveHistory();
  saveSettings();
  state.result = null;
  el.resultCard.innerHTML = '';
  $('screen-draw').classList.remove('has-result');
  resetAddForm();
  setFilter('all');
  updateDrawSub();
  renderHistory();
  syncSettingsUI();
  showToast('已清空');
}

function bindEvents() {
  document.querySelectorAll('.dock-btn').forEach((button) => {
    button.addEventListener('click', () => openSheet(button.dataset.sheet));
  });

  document.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => openSheet(button.dataset.go));
  });

  document.querySelectorAll('[data-close]').forEach((button) => {
    button.addEventListener('click', closeSheet);
  });

  el.sheetBackdrop.addEventListener('click', closeSheet);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeSheet();
      closePickedView();
    }
  });

  document.querySelectorAll('#catSeg .seg-item').forEach((button) => {
    button.addEventListener('click', () => setCategory(button.dataset.cat));
  });

  document.querySelectorAll('#typeSeg .seg-item').forEach((button) => {
    button.addEventListener('click', () => setAddType(button.dataset.type));
  });

  document.querySelectorAll('#filterRow .filter').forEach((button) => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });

  el.deck.addEventListener('click', startDraw);
  el.locBtn.addEventListener('click', () => locate().catch(() => {}));
  el.addLocBtn.addEventListener('click', () => locate().catch(() => {}));
  el.placeSearchBtn.addEventListener('click', searchPlaces);
  el.recommendBtn.addEventListener('click', recommendNearby);
  el.placeSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchPlaces();
  });

  el.placeResults.addEventListener('click', (event) => {
    const recommendButton = event.target.closest('[data-recommend-index]');
    if (recommendButton) {
      addRecommended(Number(recommendButton.dataset.recommendIndex));
      return;
    }

    const button = event.target.closest('.choose-btn');
    if (!button) return;
    selectPlace(Number(button.dataset.index));
  });

  el.addShopBtn.addEventListener('click', addShop);

  el.tagRow.addEventListener('click', (event) => {
    const button = event.target.closest('.tag-chip');
    if (!button) return;
    const tag = button.dataset.tag;
    if (state.selectedTags.has(tag)) {
      state.selectedTags.delete(tag);
      button.classList.remove('active');
    } else {
      state.selectedTags.add(tag);
      button.classList.add('active');
    }
  });

  el.resultCard.addEventListener('click', (event) => {
    const button = event.target.closest('[data-result-action]');
    if (!button) return;
    if (button.dataset.resultAction === 'again') startDraw();
    if (button.dataset.resultAction === 'picked') pickedCurrent();
    if (button.dataset.resultAction === 'navigate' && state.result) {
      openAmapNavigation(
        { lat: state.result.lat, lng: state.result.lng },
        state.result.name,
        state.result.address
      );
    }
  });

  el.shopList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (button) {
      if (button.dataset.action === 'pin') togglePin(button.dataset.id);
      if (button.dataset.action === 'delete') deleteShop(button.dataset.id);
      if (button.dataset.action === 'edit-dishes') editDishes(button.dataset.id);
      if (button.dataset.action === 'navigate') {
        const shop = state.shops.find((item) => item.id === button.dataset.id);
        if (shop) {
          openAmapNavigation(
            { lat: shop.lat, lng: shop.lng },
            shop.name,
            shop.address
          );
        }
      }
      return;
    }

    const card = event.target.closest('.shop-card');
    if (!card) return;
    if (!event.target.closest('.shop-head') && !event.target.closest('.shop-preview')) return;

    const id = card.dataset.shopId;
    state.expandedShopId = state.expandedShopId === id ? null : id;
    renderList();
  });

  el.setAvoid.addEventListener('change', () => {
    state.settings.avoidRecent = el.setAvoid.checked;
    saveSettings();
    updateDrawSub();
  });
  el.setTag.addEventListener('change', () => {
    state.settings.tagWeight = el.setTag.checked;
    saveSettings();
  });
  el.setRating.addEventListener('change', () => {
    state.settings.ratingFirst = el.setRating.checked;
    saveSettings();
  });

  el.exportBtn.addEventListener('click', exportData);
  el.importBtn.addEventListener('click', () => el.importFile.click());
  el.importFile.addEventListener('change', () => importData(el.importFile.files[0]));
  el.demoBtn.addEventListener('click', () => loadDemoData(false));
  el.clearBtn.addEventListener('click', clearAll);

  el.clearGeoBtn.addEventListener('click', () => {
    state.pendingLocation = null;
    el.geoNote.hidden = true;
  });

  el.navigateBtn.addEventListener('click', navigateToSelected);

  el.pickedNavigateBtn.addEventListener('click', () => {
    const shop = state.pickedShop;
    if (!shop) return;
    openAmapNavigation(
      { lat: shop.lat, lng: shop.lng },
      shop.name,
      shop.address
    );
  });
  el.pickedBackBtn.addEventListener('click', closePickedView);
  el.pickedView.addEventListener('click', (event) => {
    if (event.target === el.pickedView) closePickedView();
  });
}

function init() {
  el.locText = $('locText');
  el.addLocText = $('addLocText');
  el.locBtn = $('locBtn');
  el.addLocBtn = $('addLocBtn');
  el.drawTitle = $('drawTitle');
  el.drawSub = $('drawSub');
  el.drawEmpty = $('drawEmpty');
  el.deck = $('deck');
  el.deckBadge = $('deckBadge');
  el.deckHint = $('deckHint');
  el.deckBack1 = $('deckBack1');
  el.deckBack2 = $('deckBack2');
  el.sheetBackdrop = $('sheetBackdrop');
  el.ticker = $('ticker');
  el.resultCard = $('resultCard');
  el.shopCount = $('shopCount');
  el.shopList = $('shopList');
  el.listEmpty = $('listEmpty');
  el.placeSearch = $('placeSearch');
  el.placeSearchBtn = $('placeSearchBtn');
  el.placeResults = $('placeResults');
  el.recommendBtn = $('recommendBtn');
  el.recommendLabel = $('recommendLabel');
  el.providerHint = $('providerHint');
  el.shopName = $('shopName');
  el.shopAddress = $('shopAddress');
  el.shopRating = $('shopRating');
  el.shopDishes = $('shopDishes');
  el.geoNote = $('geoNote');
  el.geoNoteText = $('geoNoteText');
  el.navigateBtn = $('navigateBtn');
  el.pickedView = $('pickedView');
  el.pickedName = $('pickedName');
  el.pickedAddress = $('pickedAddress');
  el.pickedDishes = $('pickedDishes');
  el.pickedNavigateBtn = $('pickedNavigateBtn');
  el.pickedBackBtn = $('pickedBackBtn');
  el.clearGeoBtn = $('clearGeoBtn');
  el.tagRow = $('tagRow');
  el.addShopBtn = $('addShopBtn');
  el.setAvoid = $('setAvoid');
  el.setTag = $('setTag');
  el.setRating = $('setRating');
  el.historyList = $('historyList');
  el.exportBtn = $('exportBtn');
  el.importBtn = $('importBtn');
  el.importFile = $('importFile');
  el.demoBtn = $('demoBtn');
  el.clearBtn = $('clearBtn');
  el.toast = $('toast');

  loadState();
  bindEvents();

  const mapConfig = window.APP_CONFIG || {};
  if (el.providerHint) {
    const provider = mapConfig.amapKey
      ? '高德地图'
      : (mapConfig.tencentMapKey ? '腾讯地图' : '地图服务');
    el.providerHint.textContent = '地点搜索由' + provider
      + '提供，需要允许定位；搜不到也可以在下方手动填写。';
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === '1' && !state.shops.length) {
    loadDemoData();
  }

  const testConfig = window.APP_CONFIG || {};
  if (params.get('testSearch') === '1' && (testConfig.amapKey || testConfig.tencentMapKey)) {
    const testFn = testConfig.amapKey ? amapSearch : tencentSearch;
    testFn('牛肉面', { lat: 22.5405, lng: 113.9545 }).then((data) => {
      document.documentElement.dataset.tencentSearch = 'ok:' + data.length;
    }).catch((err) => {
      document.documentElement.dataset.tencentSearch = 'error:'
        + (err && err.message ? err.message : 'unknown');
    });
  }

  renderList();
  updateDrawSub();
  renderHistory();
  syncSettingsUI();

  if (params.get('testDraw') === '1') {
    setTimeout(() => {
      startDraw();
      if (params.get('testPick') === '1') {
        setTimeout(pickedCurrent, 1600);
      }
    }, 600);
  }

  const tab = params.get('tab');
  if (['list', 'add', 'me'].indexOf(tab) > -1) openSheet(tab);
  locate().catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
