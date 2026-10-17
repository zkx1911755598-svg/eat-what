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
  currentPosition: null,
  pendingLocation: null,
  searchResults: [],
  selectedTags: new Set(),
  spinning: false,
  result: null,
  tickTimer: null,
  drawTimer: null
};

const el = {};
let tencentMapPromise = null;

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

function switchScreen(tab) {
  document.querySelectorAll('.screen').forEach((screen) => {
    screen.classList.toggle('active', screen.id === 'screen-' + tab);
  });
  document.querySelectorAll('.tab').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === tab);
  });

  if (tab === 'draw') updateDrawSub();
  if (tab === 'list') renderList();
  if (tab === 'me') {
    renderHistory();
    syncSettingsUI();
  }
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
}

function startDraw() {
  if (state.spinning) return;

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
  el.wheel.classList.add('spinning');
  el.ticker.textContent = eligible.pool[0].name;

  let index = 0;
  state.tickTimer = setInterval(() => {
    index += 1;
    el.ticker.textContent = eligible.pool[index % eligible.pool.length].name;
  }, 90);

  state.drawTimer = setTimeout(() => {
    clearInterval(state.tickTimer);
    state.spinning = false;
    el.wheel.classList.remove('spinning');
    el.ticker.textContent = '';
    state.result = picked;
    renderResult(picked);
  }, 1250);
}

function renderResult(shop) {
  const distance = distanceText(shop.distance);
  const tags = (shop.tags || [])
    .map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>')
    .join('');
  const note = shop.note
    ? '<div class="r-note">备注：' + escapeHtml(shop.note) + '</div>'
    : '';

  el.resultCard.innerHTML = `
    <div class="result-card">
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
      <div class="r-addr">${escapeHtml(shop.address || '')}</div>
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
  renderList();
  updateDrawSub();
  renderHistory();
  showToast('已记录，下次会避开');
}

function shopCardHtml(shop) {
  const tags = (shop.tags || [])
    .map((tag) => '<span class="tag">' + escapeHtml(tag) + '</span>')
    .join('');
  const rating = shop.rating == null ? '—' : shop.rating;
  const distance = distanceText(shop.distance);

  return `
    <article class="shop-card">
      <div class="shop-head">
        <div class="shop-name-wrap">
          ${shop.pinned ? PIN_SVG : ''}
          <span class="shop-name">${escapeHtml(shop.name)}</span>
        </div>
        <div class="shop-right">
          <span class="shop-dist">${distance}</span>
          <span class="mini-badge ${shop.type}">${shop.type === 'food' ? '吃' : '饮'}</span>
        </div>
      </div>
      <div class="shop-addr">${escapeHtml(shop.address || '')}</div>
      <div class="shop-meta">
        <span class="shop-stars">${stars(shop.rating)}</span>
        <span class="num">${rating}</span>
        ${tags}
      </div>
      <div class="shop-actions">
        <button class="action" data-action="pin" data-id="${escapeHtml(shop.id)}" type="button">${shop.pinned ? '取消置顶' : '置顶'}</button>
        <button class="action danger" data-action="delete" data-id="${escapeHtml(shop.id)}" type="button">删除</button>
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

function deleteShop(id) {
  const shop = state.shops.find((item) => item.id === id);
  if (!shop) return;
  if (!window.confirm('确定删除「' + shop.name + '」吗？')) return;

  state.shops = state.shops.filter((item) => item.id !== id);
  if (state.result && state.result.id === id) {
    state.result = null;
    el.resultCard.innerHTML = '';
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
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      state.currentPosition = {
        lat: position.coords.latitude,
        lng: position.coords.longitude
      };
      setLocText('已定位');
      refreshDistances();
      updateGeoNote();
    },
    () => {
      setLocText('未定位');
      updateGeoNote();
    },
    {
      enableHighAccuracy: false,
      timeout: 8000,
      maximumAge: 600000
    }
  );
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

function loadTencentMap() {
  if (window.TMap && window.TMap.service) {
    document.documentElement.dataset.tencentSdk = 'ok';
    return Promise.resolve();
  }
  if (tencentMapPromise) return tencentMapPromise;

  const config = window.APP_CONFIG || {};
  if (!config.tencentMapKey) {
    document.documentElement.dataset.tencentSdk = 'missing';
    return Promise.reject(new Error('TENCENT_KEY_MISSING'));
  }

  document.documentElement.dataset.tencentSdk = 'loading';
  tencentMapPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://map.qq.com/api/gljs?v=1.exp&key='
      + encodeURIComponent(config.tencentMapKey)
      + '&libraries=service';
    script.async = true;
    script.onload = () => {
      if (window.TMap && window.TMap.service) {
        document.documentElement.dataset.tencentSdk = 'ok';
        resolve();
      } else {
        document.documentElement.dataset.tencentSdk = 'error';
        tencentMapPromise = null;
        reject(new Error('TENCENT_LOAD_FAILED'));
      }
    };
    script.onerror = () => {
      document.documentElement.dataset.tencentSdk = 'error';
      tencentMapPromise = null;
      reject(new Error('TENCENT_LOAD_FAILED'));
    };
    document.head.appendChild(script);
  });

  return tencentMapPromise;
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
  if (!config.tencentMapKey) {
    showToast('请先配置腾讯地图 Key');
    return;
  }
  if (!state.currentPosition) {
    showToast('请先允许定位，再搜索附近店铺');
    locate();
    return;
  }

  el.placeSearchBtn.disabled = true;
  el.placeSearchBtn.textContent = '搜索中';
  el.placeResults.innerHTML = '<div class="hint">正在搜索附近地点…</div>';

  try {
    await loadTencentMap();
    const search = new TMap.service.Search({ pageSize: 20 });
    const center = new TMap.LatLng(state.currentPosition.lat, state.currentPosition.lng);
    const result = await search.searchNearby({
      keyword,
      center,
      radius: 1000,
      autoExtend: true,
      orderby: '_distance'
    });

    const data = (result && result.data) || [];
    state.searchResults = data.map((item) => {
      const location = item.location || {};
      const lat = Number(location.lat);
      const lng = Number(location.lng);
      let distance = Number(item._distance);
      if (!distance && lat && lng) {
        distance = haversine(state.currentPosition, { lat, lng });
      }
      return {
        name: item.title || item.name || '未命名地点',
        address: item.address || '',
        lat,
        lng,
        distance
      };
    }).filter((item) => item.name && item.lat && item.lng);

    renderSearchResults();
  } catch (err) {
    state.searchResults = [];
    el.placeResults.innerHTML = '<div class="hint">腾讯地图搜索失败，请检查 Key、域名白名单和定位权限，或手动填写下方信息。</div>';
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

  state.shops.push(normalizeShop({
    id: uid(),
    name,
    type: state.addType,
    address,
    lat: pending ? pending.lat : null,
    lng: pending ? pending.lng : null,
    distance,
    rating,
    tags: Array.from(state.selectedTags),
    note: '',
    pinned: false,
    lastEatenAt: null,
    createdAt: Date.now()
  }));

  saveShops();
  resetAddForm();
  setFilter('all');
  updateDrawSub();
  showToast('已添加到收藏');
  switchScreen('list');
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
    { name: '老王牛肉面', type: 'food', address: '科技园南路 12 号', rating: 4.6, tags: ['面食', '常去'], lastDays: 5 },
    { name: '蜀香火锅', type: 'food', address: '海岸城 3 层 305', rating: 4.8, tags: ['火锅', '聚餐'], lastDays: 2 },
    { name: '轻食沙拉', type: 'food', address: '软件产业基地 2 栋', rating: 4.3, tags: ['轻食', '健康'], lastDays: null },
    { name: '日式烧肉', type: 'food', address: '万象天地 B1', rating: 4.7, tags: ['烧肉', '约会'], lastDays: null },
    { name: '兰州拉面', type: 'food', address: '科苑北路 11 号', rating: 4.2, tags: ['面食', '平价'], lastDays: null },
    { name: '一点点', type: 'drink', address: '科苑路 8 号', rating: 4.5, tags: ['奶茶', '外卖'], lastDays: 6 },
    { name: '喜茶', type: 'drink', address: '海岸城 1 层', rating: 4.7, tags: ['奶茶', '招牌'], lastDays: 1 },
    { name: '瑞幸咖啡', type: 'drink', address: '软件产业基地 1 栋', rating: 4.4, tags: ['咖啡', '提神'], lastDays: null },
    { name: '椰子冰沙', type: 'drink', address: '深大西门', rating: 4.2, tags: ['甜品', '清爽'], lastDays: null },
    { name: '蜜雪冰城', type: 'drink', address: '科苑南路 3 号', rating: 4.1, tags: ['奶茶', '平价'], lastDays: null }
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
  resetAddForm();
  setFilter('all');
  updateDrawSub();
  renderHistory();
  syncSettingsUI();
  showToast('已清空');
}

function bindEvents() {
  document.querySelectorAll('.tab').forEach((button) => {
    button.addEventListener('click', () => switchScreen(button.dataset.tab));
  });

  document.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => switchScreen(button.dataset.go));
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

  el.wheel.addEventListener('click', startDraw);
  el.locBtn.addEventListener('click', locate);
  el.addLocBtn.addEventListener('click', locate);
  el.placeSearchBtn.addEventListener('click', searchPlaces);
  el.placeSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') searchPlaces();
  });

  el.placeResults.addEventListener('click', (event) => {
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
  });

  el.shopList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    if (button.dataset.action === 'pin') togglePin(button.dataset.id);
    if (button.dataset.action === 'delete') deleteShop(button.dataset.id);
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
}

function init() {
  el.locText = $('locText');
  el.addLocText = $('addLocText');
  el.locBtn = $('locBtn');
  el.addLocBtn = $('addLocBtn');
  el.drawTitle = $('drawTitle');
  el.drawSub = $('drawSub');
  el.drawEmpty = $('drawEmpty');
  el.wheel = $('wheel');
  el.ticker = $('ticker');
  el.resultCard = $('resultCard');
  el.shopCount = $('shopCount');
  el.shopList = $('shopList');
  el.listEmpty = $('listEmpty');
  el.placeSearch = $('placeSearch');
  el.placeSearchBtn = $('placeSearchBtn');
  el.placeResults = $('placeResults');
  el.shopName = $('shopName');
  el.shopAddress = $('shopAddress');
  el.shopRating = $('shopRating');
  el.geoNote = $('geoNote');
  el.geoNoteText = $('geoNoteText');
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

  if (window.APP_CONFIG && window.APP_CONFIG.tencentMapKey) {
    loadTencentMap().catch(() => {});
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('demo') === '1' && !state.shops.length) {
    loadDemoData();
  }

  if (params.get('testSearch') === '1' && window.APP_CONFIG.tencentMapKey) {
    loadTencentMap().then(() => {
      const search = new TMap.service.Search({ pageSize: 5 });
      const center = new TMap.LatLng(22.5405, 113.9545);
      return search.searchNearby({
        keyword: '牛肉面',
        center,
        radius: 1000,
        autoExtend: true
      });
    }).then((res) => {
      const count = res && res.data ? res.data.length : 0;
      document.documentElement.dataset.tencentSearch = 'ok:' + count;
    }).catch((err) => {
      document.documentElement.dataset.tencentSearch = 'error:'
        + (err && err.message ? err.message : 'unknown');
    });
  }

  renderList();
  updateDrawSub();
  renderHistory();
  syncSettingsUI();

  const tab = params.get('tab');
  switchScreen(['draw', 'list', 'add', 'me'].indexOf(tab) > -1 ? tab : 'draw');
  locate();
}

document.addEventListener('DOMContentLoaded', init);
