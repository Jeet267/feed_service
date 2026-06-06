(() => {
  'use strict';

  const API = (window.API_BASE || '').replace(/\/$/, '');
  const AREAS = [
    { name: 'Koramangala', lat: 12.9352, lng: 77.6245 },
    { name: 'Indiranagar', lat: 12.9784, lng: 77.6408 },
    { name: 'HSR Layout', lat: 12.9116, lng: 77.6474 },
    { name: 'Whitefield', lat: 12.9698, lng: 77.75 },
    { name: 'Jayanagar', lat: 12.925, lng: 77.5938 },
    { name: 'Malleshwaram', lat: 13.0035, lng: 77.5647 },
    { name: 'Electronic City', lat: 12.8452, lng: 77.6602 },
    { name: 'Hebbal', lat: 13.0358, lng: 77.597 },
  ];
  const CATEGORIES = ['news', 'jobs', 'events', 'classifieds', 'alerts'];
  const CAT_COLOR = {
    news: '#1c7ed6', jobs: '#2b8a3e', events: '#ae3ec9', classifieds: '#e67700', alerts: '#e03131',
  };

  // ---------- small helpers ----------
  const $ = (id) => document.getElementById(id);
  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode etc. */ }
    },
  };

  const userId = storage.get('hf_user', null) || `web-${Math.random().toString(36).slice(2, 10)}`;
  storage.set('hf_user', userId);
  const liked = new Set(storage.get('hf_liked', []));

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    });
    // textContent everywhere: user-generated content is never parsed as HTML.
    children.flat().forEach((c) => node.append(c instanceof Node ? c : document.createTextNode(String(c))));
    return node;
  }

  function timeAgo(iso) {
    const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add('hidden'), 3500);
  }

  async function api(path, { method = 'GET', body, query } = {}) {
    const url = new URL(`${API}${path}`, window.location.origin);
    if (query) Object.entries(query).forEach(([k, v]) => v !== undefined && v !== null && v !== '' && url.searchParams.set(k, v));
    const started = performance.now();
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'x-user-id': userId },
      body: body ? JSON.stringify(body) : undefined,
    });
    const ms = Math.round(performance.now() - started);
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const retry = res.headers.get('Retry-After');
      const msg = res.status === 429
        ? `Slow down! Rate limit hit, try again in ${retry || 'a few'}s.`
        : (data && data.error && data.error.message) || `Request failed (${res.status})`;
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    return { data, ms, headers: res.headers };
  }

  // ---------- state ----------
  const state = {
    lat: AREAS[0].lat,
    lng: AREAS[0].lng,
    radiusKm: 5,
    category: '',
    tab: 'nearby',
    cursor: null,
    items: [],
    loading: false,
    requestId: 0,
  };

  // ---------- map ----------
  const map = L.map('map', { zoomControl: true }).setView([state.lat, state.lng], 13);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  const youMarker = L.circleMarker([state.lat, state.lng], {
    radius: 8, color: '#fff', weight: 3, fillColor: '#e8590c', fillOpacity: 1,
  }).addTo(map).bindTooltip('You');
  const radiusCircle = L.circle([state.lat, state.lng], {
    radius: state.radiusKm * 1000, color: '#e8590c', weight: 1, fillOpacity: 0.06,
  }).addTo(map);
  const postLayer = L.layerGroup().addTo(map);
  const markersById = new Map();

  map.on('click', (e) => {
    $('areaSelect').value = '';
    setLocation(e.latlng.lat, e.latlng.lng, false);
  });

  function setLocation(lat, lng, recenter = true) {
    state.lat = Number(lat.toFixed(5));
    state.lng = Number(lng.toFixed(5));
    youMarker.setLatLng([state.lat, state.lng]);
    radiusCircle.setLatLng([state.lat, state.lng]);
    if (recenter) map.setView([state.lat, state.lng], zoomFor(state.radiusKm));
    reload();
  }

  const zoomFor = (km) => (km <= 1 ? 15 : km <= 2 ? 14 : km <= 5 ? 13 : km <= 10 ? 12 : 11);

  // ---------- rendering ----------
  function renderCard(post) {
    const isLiked = liked.has(post.id);
    const likeBtn = el('button', {
      class: `like${isLiked ? ' liked' : ''}`,
      'aria-pressed': String(isLiked),
      onclick: (e) => { e.stopPropagation(); toggleLike(post, likeBtn); },
    }, `♥ ${post.likeCount}`);

    const card = el('li', {
      class: 'card',
      tabindex: '0',
      'data-id': post.id,
      onclick: () => focusPost(post.id),
      onkeydown: (e) => { if (e.key === 'Enter') focusPost(post.id); },
    },
      el('div', { class: 'card-top' },
        el('span', { class: 'cat', style: `color:${CAT_COLOR[post.category]}` }, post.category),
        el('span', {}, '·'),
        el('span', {}, `${post.distanceKm} km away`),
        el('span', {}, '·'),
        el('span', {}, timeAgo(post.createdAt))),
      el('h3', {}, post.title),
      el('p', {}, post.body),
      el('div', { class: 'card-bottom' },
        likeBtn,
        post.score !== undefined ? el('span', { class: 'score' }, `hot score ${post.score}`) : el('span')));
    return card;
  }

  function addMarker(post) {
    const icon = L.divIcon({
      className: '',
      html: `<div class="post-pin" style="background:${CAT_COLOR[post.category]}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });
    // Pass a DOM node, not a string: Leaflet renders string tooltips as HTML.
    const marker = L.marker([post.location.lat, post.location.lng], { icon })
      .bindTooltip(el('span', {}, post.title))
      .addTo(postLayer);
    marker.on('click', () => {
      const card = document.querySelector(`.card[data-id="${post.id}"]`);
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); highlight(post.id); }
    });
    markersById.set(post.id, marker);
  }

  function highlight(id) {
    document.querySelectorAll('.card.focus').forEach((c) => c.classList.remove('focus'));
    const card = document.querySelector(`.card[data-id="${id}"]`);
    if (card) card.classList.add('focus');
  }

  function focusPost(id) {
    const m = markersById.get(id);
    if (m) { map.panTo(m.getLatLng()); m.openTooltip(); }
    highlight(id);
  }

  function renderMeta({ ms, cache, count }) {
    const meta = $('meta');
    meta.replaceChildren();
    if (cache) meta.append(el('span', { class: `badge ${cache === 'HIT' ? 'hit' : 'miss'}`, title: 'Redis cache result' }, `CACHE ${cache}`));
    meta.append(el('span', {}, `${count} posts · ${ms} ms`));
  }

  // ---------- data ----------
  async function reload() {
    state.cursor = null;
    state.items = [];
    $('feed').replaceChildren();
    postLayer.clearLayers();
    markersById.clear();
    await load();
  }

  async function load() {
    const reqId = ++state.requestId; // ignore responses from stale requests
    state.loading = true;
    $('loadMore').disabled = true;
    try {
      const query = { lat: state.lat, lng: state.lng, category: state.category };
      let result;
      if (state.tab === 'nearby') {
        result = await api('/api/v1/feed/nearby', { query: { ...query, radiusKm: state.radiusKm, limit: 20, cursor: state.cursor } });
      } else {
        result = await api('/api/v1/feed/trending', { query });
      }
      if (reqId !== state.requestId) return;

      const { data, ms } = result;
      data.items.forEach((p) => {
        state.items.push(p);
        $('feed').append(renderCard(p));
        addMarker(p);
      });
      state.cursor = data.nextCursor || null;
      $('loadMore').classList.toggle('hidden', !state.cursor);
      $('empty').classList.toggle('hidden', state.items.length > 0);
      renderMeta({ ms, cache: data.cache, count: state.items.length });
      if (state.tab === 'trending') refreshStats();
    } catch (err) {
      if (reqId === state.requestId) toast(err.message);
    } finally {
      if (reqId === state.requestId) {
        state.loading = false;
        $('loadMore').disabled = false;
      }
    }
  }

  async function toggleLike(post, btn) {
    const wasLiked = liked.has(post.id);
    btn.disabled = true;
    try {
      const { data } = await api(`/api/v1/posts/${post.id}/like`, { method: wasLiked ? 'DELETE' : 'POST', body: { userId } });
      if (data.changed) post.likeCount += wasLiked ? -1 : 1;
      if (wasLiked) liked.delete(post.id); else liked.add(post.id);
      storage.set('hf_liked', [...liked]);
      btn.textContent = `♥ ${post.likeCount}`;
      btn.classList.toggle('liked', !wasLiked);
      btn.setAttribute('aria-pressed', String(!wasLiked));
    } catch (err) {
      toast(err.message);
    } finally {
      btn.disabled = false;
    }
  }

  async function refreshStats() {
    try {
      const { data } = await api('/api/v1/stats/cache');
      $('stats').replaceChildren(
        el('span', {}, 'Trending cache: '),
        el('span', {}, el('b', {}, `${Math.round(data.hitRate * 100)}%`), ' hit rate'),
        el('span', {}, el('b', {}, data.hits), ' hits'),
        el('span', {}, el('b', {}, data.misses), ' misses'),
      );
    } catch { /* stats are optional */ }
  }

  // ---------- controls ----------
  function setupControls() {
    const areaSelect = $('areaSelect');
    areaSelect.append(el('option', { value: '', disabled: '' }, 'Custom spot'));
    AREAS.forEach((a, i) => areaSelect.append(el('option', { value: String(i) }, a.name)));
    areaSelect.value = '0';
    areaSelect.addEventListener('change', () => {
      const a = AREAS[Number(areaSelect.value)];
      if (a) setLocation(a.lat, a.lng);
    });

    $('radiusSelect').addEventListener('change', (e) => {
      state.radiusKm = Number(e.target.value);
      radiusCircle.setRadius(state.radiusKm * 1000);
      map.setView([state.lat, state.lng], zoomFor(state.radiusKm));
      if (state.tab === 'nearby') reload();
    });

    $('locateBtn').addEventListener('click', () => {
      if (!navigator.geolocation) return toast('Location is not available in this browser.');
      $('locateBtn').disabled = true;
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          $('locateBtn').disabled = false;
          $('areaSelect').value = '';
          setLocation(pos.coords.latitude, pos.coords.longitude);
          toast('Showing posts around you. Demo data is seeded in Bengaluru, so pick an area there if this is empty.');
        },
        () => { $('locateBtn').disabled = false; toast('Could not get your location.'); },
        { enableHighAccuracy: false, timeout: 8000 },
      );
    });

    const chips = $('categoryChips');
    ['', ...CATEGORIES].forEach((c) => {
      const chip = el('button', { class: `chip${c === '' ? ' active' : ''}`, 'data-cat': c, 'aria-pressed': String(c === '') }, c || 'all');
      chip.addEventListener('click', () => {
        state.category = c;
        chips.querySelectorAll('.chip').forEach((x) => {
          const on = x.dataset.cat === c;
          x.classList.toggle('active', on);
          x.setAttribute('aria-pressed', String(on));
        });
        reload();
      });
      chips.append(chip);
    });

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        state.tab = tab.dataset.tab;
        document.querySelectorAll('.tab').forEach((t) => {
          const on = t === tab;
          t.classList.toggle('active', on);
          t.setAttribute('aria-selected', String(on));
        });
        reload();
      });
    });

    $('loadMore').addEventListener('click', () => { if (!state.loading) load(); });

    // New post dialog
    const dialog = $('postDialog');
    const form = $('postForm');
    CATEGORIES.forEach((c) => $('postCategory').append(el('option', { value: c }, c)));
    $('newPostBtn').addEventListener('click', () => {
      $('postWhere').textContent = `Will be posted at the orange pin (${state.lat}, ${state.lng}). Click the map first to choose another spot.`;
      dialog.showModal();
    });
    $('cancelPost').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const submit = form.querySelector('button[type="submit"]');
      submit.disabled = true;
      try {
        await api('/api/v1/posts', {
          method: 'POST',
          body: {
            authorId: userId,
            title: fd.get('title'),
            body: fd.get('body'),
            category: fd.get('category'),
            lat: state.lat,
            lng: state.lng,
          },
        });
        form.reset();
        dialog.close();
        toast('Posted! It shows up in Nearby right away (Trending refreshes every minute).');
        if (state.tab === 'nearby') reload();
      } catch (err) {
        toast(err.message);
      } finally {
        submit.disabled = false;
      }
    });
  }

  setupControls();
  reload();
  refreshStats();
})();
