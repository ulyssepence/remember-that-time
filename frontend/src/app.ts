interface SegmentResult {
  video_id: string;
  segment_id: string;
  start_seconds: number;
  end_seconds: number;
  source_url: string;
  title: string;
  transcript_raw: string;
  transcript_enriched: string;
  frame_url: string | null;
  page_url: string | null;
  collection: string;
  score: number;
}

interface SearchResponse {
  query: string;
  results: SegmentResult[];
}

interface SegmentsResponse {
  segments: SegmentResult[];
  total: number;
  offset: number;
  limit: number;
}

interface CollectionInfo {
  id: string;
  video_count: number;
  segment_count: number;
}

interface MapPoint {
  segment_id: string;
  x: number;
  y: number;
  frame_url: string | null;
  collection: string;
}

type Mode = "browse" | "search" | "similar" | "map";

const PAGE_SIZE = 200;
const CELL_W = 244;
const CELL_H = 140;

let mode: Mode = "browse";
let segments: SegmentResult[] = [];
let searchResults: SegmentResult[] = [];
let activeOverlay: SegmentResult | null = null;
let query = "";
let browseOffset = 0;
let browseTotal = 0;
let loading = false;
let collections: CollectionInfo[] = [];
let activeCollections: Set<string> = new Set();
let filterOpen = false;
let shuffleOrder: number[] = [];

let panX = 0;
let panY = 0;
let dragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartPanX = 0;
let dragStartPanY = 0;
let dragMoved = false;
let velX = 0;
let velY = 0;
let lastMoveTime = 0;
let lastMoveX = 0;
let lastMoveY = 0;
let inertiaRaf = 0;

// ── Map state ──
let mapPoints: MapPoint[] = [];
let gpu: {
  device: GPUDevice;
  context: GPUCanvasContext;
  computePipeline: GPUComputePipeline;
  renderPipeline: GPURenderPipeline;
  particleBufs: [GPUBuffer, GPUBuffer];
  counterBuf: GPUBuffer;
  inputsBuf: GPUBuffer;
  computeBindGroups: [GPUBindGroup, GPUBindGroup];
  renderBindGroups: [GPUBindGroup, GPUBindGroup];
  particleCount: number;
  frame: number;
  startTime: number;
  lastTime: number;
  pingpong: number;
  raf: number;
} | null = null;

let camX = 0.5, camY = 0.5, camZoom = 1.0;
let camTargetX = 0.5, camTargetY = 0.5, camTargetZoom = 1.0;
let mapDragging = false;
let mapDragStartX = 0, mapDragStartY = 0;
let mapDragStartCamX = 0, mapDragStartCamY = 0;
let mapDragMoved = false;
let mapMouseX = 0, mapMouseY = 0;
let highlightedIds: Set<string> = new Set();

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function esc(s: string): string {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function isYouTube(url: string | null): boolean {
  if (!url) return false;
  return url.includes("youtube.com/watch") || url.includes("youtu.be/");
}

function youtubeVideoId(url: string): string | null {
  const m = url.match(/[?&]v=([^&]+)/) || url.match(/youtu\.be\/([^?]+)/);
  return m ? m[1] : null;
}

function collectionParam(): string {
  if (activeCollections.size === 0) return "";
  return `&collections=${[...activeCollections].join(",")}`;
}

async function fetchSegments(offset: number, limit: number): Promise<SegmentsResponse> {
  const resp = await fetch(`/segments?offset=${offset}&limit=${limit}${collectionParam()}`);
  return resp.json();
}

async function fetchSearch(q: string, n = 50): Promise<SegmentResult[]> {
  const resp = await fetch(`/search?q=${encodeURIComponent(q)}&n=${n}${collectionParam()}`);
  if (!resp.ok) return [];
  const data: SearchResponse = await resp.json();
  return data.results;
}

async function fetchSimilar(segmentId: string, n = 50): Promise<SegmentResult[]> {
  const resp = await fetch(`/search?segment_id=${encodeURIComponent(segmentId)}&n=${n}${collectionParam()}`);
  if (!resp.ok) return [];
  const data: SearchResponse = await resp.json();
  return data.results;
}

async function fetchCollections(): Promise<CollectionInfo[]> {
  const resp = await fetch("/collections");
  const data = await resp.json();
  return data.collections;
}

async function fetchMap(): Promise<MapPoint[]> {
  const resp = await fetch("/map");
  const data = await resp.json();
  return data.points;
}

async function loadInitialSegments() {
  loading = true;
  render();
  const data = await fetchSegments(0, PAGE_SIZE);
  segments = data.segments;
  browseTotal = data.total;
  browseOffset = segments.length;
  shuffleOrder = Array.from({ length: segments.length }, (_, i) => i);
  shuffle(shuffleOrder);
  loading = false;
  render();
  centerCanvas();
}

async function loadMoreSegments() {
  if (loading || browseOffset >= browseTotal) return;
  loading = true;
  const data = await fetchSegments(browseOffset, PAGE_SIZE);
  const newStart = segments.length;
  segments.push(...data.segments);
  browseOffset += data.segments.length;
  const newIndices = Array.from({ length: data.segments.length }, (_, i) => newStart + i);
  shuffle(newIndices);
  shuffleOrder.push(...newIndices);
  loading = false;
  render();
}

function shuffle(arr: number[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function displaySegments(): SegmentResult[] {
  if (mode === "browse") {
    return shuffleOrder.map(i => segments[i]);
  }
  return searchResults;
}


function renderFilterPanel(): string {
  if (!filterOpen) return "";
  return `
    <div class="filter-panel">
      ${collections.map(c => `
        <label class="filter-item">
          <input type="checkbox" data-collection="${esc(c.id)}" ${activeCollections.has(c.id) ? "checked" : ""} />
          <span>${esc(c.id || "(no collection)")}</span>
          <span class="filter-count">${c.video_count} videos, ${c.segment_count} segments</span>
        </label>
      `).join("")}
    </div>
  `;
}

function renderVideoOverlay(): string {
  if (!activeOverlay) return "";
  const seg = activeOverlay;
  const ytId = seg.page_url && isYouTube(seg.page_url) ? youtubeVideoId(seg.page_url) : null;
  const startInt = Math.floor(seg.start_seconds);

  let playerHtml: string;
  if (ytId) {
    playerHtml = `<div class="yt-container"><iframe id="yt-iframe" src="https://www.youtube.com/embed/${ytId}?start=${startInt}&autoplay=1" frameborder="0" allow="autoplay; encrypted-media" allowfullscreen></iframe></div>`;
  } else {
    playerHtml = `<video id="video-player" controls crossorigin autoplay><source src="${esc(seg.source_url)}" /></video>`;
  }

  return `
    <div class="overlay" id="overlay">
      <div class="overlay-content">
        <button class="close-btn" id="close-overlay">&times;</button>
        <div class="overlay-player">${playerHtml}</div>
        <div class="overlay-info">
          <h2 class="overlay-title">${esc(seg.title)}</h2>
          <div class="overlay-time">${formatTime(seg.start_seconds)} — ${formatTime(seg.end_seconds)}</div>
          <p class="overlay-transcript">${esc(seg.transcript_raw)}</p>
          ${seg.collection ? `<div class="overlay-collection">${esc(seg.collection)}</div>` : ""}
          ${seg.page_url ? `<a class="overlay-source" href="${esc(seg.page_url)}" target="_blank" rel="noopener">View source</a>` : ""}
        </div>
      </div>
    </div>
  `;
}

interface CellLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

function layoutCells(items: SegmentResult[], cols: number, isSearch: boolean): CellLayout[] {
  const cells: CellLayout[] = [];
  if (items.length === 0) return cells;

  if (isSearch && cols >= 2) {
    cells.push({ x: 0, y: 0, w: CELL_W * 2, h: CELL_H * 2 });
    const occupied = new Set<string>();
    occupied.add("0,0"); occupied.add("1,0"); occupied.add("0,1"); occupied.add("1,1");
    let idx = 1;
    for (let row = 0; idx < items.length; row++) {
      for (let col = 0; col < cols && idx < items.length; col++) {
        if (!occupied.has(`${col},${row}`)) {
          cells.push({ x: col * CELL_W, y: row * CELL_H, w: CELL_W, h: CELL_H });
          idx++;
        }
      }
    }
  } else {
    for (let i = 0; i < items.length; i++) {
      const row = Math.floor(i / cols);
      const col = i % cols;
      cells.push({ x: col * CELL_W, y: row * CELL_H, w: CELL_W, h: CELL_H });
    }
  }
  return cells;
}

function tileSize(cells: CellLayout[]): { w: number; h: number } {
  let maxX = 0, maxY = 0;
  for (const c of cells) {
    maxX = Math.max(maxX, c.x + c.w);
    maxY = Math.max(maxY, c.y + c.h);
  }
  return { w: maxX, h: maxY };
}

function padItems(items: SegmentResult[], cols: number): SegmentResult[] {
  if (items.length === 0) return items;
  const minCells = cols * 3;
  if (items.length >= minCells) return items;
  const padded: SegmentResult[] = [];
  while (padded.length < minCells) {
    for (let i = 0; i < items.length && padded.length < minCells; i++) {
      padded.push(items[i]);
    }
  }
  return padded;
}

function tiledCards(items: SegmentResult[], cols: number, isSearch: boolean): string {
  const originalLen = items.length;
  const wasPadded = items.length < cols * 3;
  items = padItems(items, cols);
  const cells = layoutCells(items, cols, isSearch);
  const tile = tileSize(cells);
  const tilesX = Math.max(3, Math.ceil(window.innerWidth / tile.w) + 2);
  const tilesY = Math.max(3, Math.ceil(window.innerHeight / tile.h) + 2);
  const isMobile = window.innerWidth < 768;

  const cards: string[] = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      for (let i = 0; i < items.length; i++) {
        const c = cells[i];
        const x = tx * tile.w + c.x;
        const y = ty * tile.h + c.y;
        const seg = items[i];
        cards.push(`
          <div class="card" data-idx="${i % originalLen}" style="position:absolute;left:${x}px;top:${y}px;width:${c.w - 4}px;height:${c.h - 4}px;">
            <div class="card-thumb" data-action="play">
              ${seg.frame_url ? `<img src="${seg.frame_url}" alt="" loading="lazy" />` : `<div class="card-placeholder"></div>`}
            </div>
            <div class="card-overlay" data-action="similar" data-segment-id="${seg.segment_id}">
              <span class="card-text">${esc(seg.transcript_raw.slice(0, 120))}${seg.transcript_raw.length > 120 ? "..." : ""}</span>
            </div>
          </div>
        `);
      }
    }
  }
  return cards.join("");
}

function render() {
  const root = document.getElementById("root")!;

  if (mode === "map") {
    const isSearch = searchResults.length > 0;
    root.innerHTML = `
      <div class="top-bar">
        <form class="search-bar" id="search-form">
          <input type="text" id="query" placeholder="Search across videos..." value="${esc(query)}" />
          ${query || isSearch ? `<button type="button" class="clear-btn" id="clear-search">&times;</button>` : ""}
          <button type="submit">Search</button>
          <button type="button" class="filter-btn" id="filter-toggle" title="Filter collections">&#x25A7;</button>
          <button type="button" class="map-btn active" id="map-toggle" title="Embedding map">&#x25C9;</button>
        </form>
        ${renderFilterPanel()}
      </div>
      <canvas id="map-canvas"></canvas>
      ${renderVideoOverlay()}
    `;
    bindEvents();
    return;
  }

  const rawItems = displaySegments();
  const isSearch = mode !== "browse";
  const cols = Math.max(1, Math.ceil(Math.sqrt(rawItems.length)));
  const items = padItems(rawItems, cols);
  const cells = layoutCells(items, cols, isSearch);
  const tile = tileSize(cells);
  const tilesX = Math.max(3, Math.ceil(window.innerWidth / tile.w) + 2);
  const tilesY = Math.max(3, Math.ceil(window.innerHeight / tile.h) + 2);
  const totalW = tile.w * tilesX;
  const totalH = tile.h * tilesY;

  root.innerHTML = `
    <div class="top-bar">
      <form class="search-bar" id="search-form">
        <input type="text" id="query" placeholder="Search across videos..." value="${esc(query)}" />
        ${query || isSearch ? `<button type="button" class="clear-btn" id="clear-search">&times;</button>` : ""}
        <button type="submit">Search</button>
        <button type="button" class="filter-btn" id="filter-toggle" title="Filter collections">&#x25A7;</button>
        <button type="button" class="map-btn" id="map-toggle" title="Embedding map">&#x25C9;</button>
      </form>
      ${renderFilterPanel()}
    </div>
    <div class="viewport" id="viewport">
      <div class="canvas" id="canvas" style="width:${totalW}px;height:${totalH}px;transform:translate(${panX}px,${panY}px)">
        ${rawItems.length > 0 ? tiledCards(rawItems, cols, isSearch) : ""}
        ${loading ? '<div class="status" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%)">Loading...</div>' : ""}
      </div>
    </div>
    ${renderVideoOverlay()}
  `;

  bindCanvasDrag();
  bindEvents();
}

function currentTile(): { w: number; h: number } {
  const rawItems = displaySegments();
  if (rawItems.length === 0) return { w: 1, h: 1 };
  const isSearch = mode !== "browse";
  const cols = Math.max(1, Math.ceil(Math.sqrt(rawItems.length)));
  const items = padItems(rawItems, cols);
  return tileSize(layoutCells(items, cols, isSearch));
}

function centerCanvas() {
  const rawItems = displaySegments();
  if (rawItems.length === 0) return;
  const isSearch = mode !== "browse";
  const cols = Math.max(1, Math.ceil(Math.sqrt(rawItems.length)));
  const items = padItems(rawItems, cols);
  const cells = layoutCells(items, cols, isSearch);
  const tile = tileSize(cells);
  const first = cells[0];
  const cx = tile.w + first.x + first.w / 2;
  const cy = tile.h + first.y + first.h / 2;
  panX = -cx + window.innerWidth / 2;
  panY = -cy + window.innerHeight / 2;
  wrapPan();
  updateCanvasTransform();
}

function updateCanvasTransform() {
  const canvas = document.getElementById("canvas");
  if (!canvas) return;
  canvas.style.transform = `translate(${panX}px,${panY}px)`;
}

function wrapPan() {
  const tile = currentTile();
  panX = ((panX % tile.w) + tile.w) % tile.w - tile.w;
  panY = ((panY % tile.h) + tile.h) % tile.h - tile.h;
}

function tickInertia() {
  if (dragging) return;
  if (Math.abs(velX) < 0.5 && Math.abs(velY) < 0.5) return;
  velX *= 0.92;
  velY *= 0.92;
  panX += velX;
  panY += velY;
  wrapPan();
  updateCanvasTransform();
  inertiaRaf = requestAnimationFrame(tickInertia);
}

function setupDragListeners() {
  document.addEventListener("pointermove", (e) => {
    if (mode === "map") {
      mapMouseX = e.clientX;
      mapMouseY = e.clientY;
      if (!mapDragging) return;
      const canvas = document.getElementById("map-canvas") as HTMLCanvasElement | null;
      if (!canvas) return;
      const dx = e.clientX - mapDragStartX;
      const dy = e.clientY - mapDragStartY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) mapDragMoved = true;
      const aspect = canvas.width / canvas.height;
      camX = mapDragStartCamX - dx / (canvas.height * camZoom);
      camY = mapDragStartCamY - dy / (canvas.height * camZoom);
      return;
    }
    if (!dragging) return;
    const now = performance.now();
    const dt = now - lastMoveTime;
    if (dt > 0) {
      velX = (e.clientX - lastMoveX) * (16 / dt);
      velY = (e.clientY - lastMoveY) * (16 / dt);
    }
    lastMoveTime = now;
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
    const dx = e.clientX - dragStartX;
    const dy = e.clientY - dragStartY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) dragMoved = true;
    panX = dragStartPanX + dx;
    panY = dragStartPanY + dy;
    wrapPan();
    updateCanvasTransform();
  });
  document.addEventListener("pointerup", () => {
    if (mode === "map") {
      if (mapDragging && !mapDragMoved) {
        handleMapClick(mapDragStartX, mapDragStartY);
      }
      mapDragging = false;
      return;
    }
    if (!dragging) return;
    dragging = false;
    cancelAnimationFrame(inertiaRaf);
    inertiaRaf = requestAnimationFrame(tickInertia);
  });

  document.addEventListener("wheel", (e) => {
    if ((e.target as HTMLElement).closest(".top-bar")) return;
    if ((e.target as HTMLElement).closest(".overlay")) return;
    e.preventDefault();
    if (mode === "map") {
      const canvas = document.getElementById("map-canvas") as HTMLCanvasElement | null;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mx = (e.clientX - rect.left) / rect.height;
      const my = (e.clientY - rect.top) / rect.height;
      const aspect = canvas.width / canvas.height;
      const worldX = camX + (mx - 0.5 * aspect) / camZoom;
      const worldY = camY + (my - 0.5) / camZoom;
      const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.max(0.1, Math.min(100, camZoom * zoomFactor));
      camX = worldX - (mx - 0.5 * aspect) / newZoom;
      camY = worldY - (my - 0.5) / newZoom;
      camZoom = newZoom;
      camTargetX = camX;
      camTargetY = camY;
      camTargetZoom = camZoom;
      return;
    }
    panX += e.deltaX;
    panY += e.deltaY;
    wrapPan();
    updateCanvasTransform();
  }, { passive: false });
}

function bindCanvasDrag() {
  const viewport = document.getElementById("viewport");
  if (!viewport) return;

  viewport.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest(".top-bar")) return;
    e.preventDefault();
    cancelAnimationFrame(inertiaRaf);
    velX = 0;
    velY = 0;
    dragging = true;
    dragMoved = false;
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragStartPanX = panX;
    dragStartPanY = panY;
    lastMoveTime = performance.now();
    lastMoveX = e.clientX;
    lastMoveY = e.clientY;
  });
}

function bindEvents() {
  const input = document.getElementById("query") as HTMLInputElement | null;
  if (input && document.activeElement?.tagName !== "INPUT") {
    input.focus();
    input.selectionStart = input.selectionEnd = input.value.length;
  }

  document.getElementById("search-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("query") as HTMLInputElement;
    query = input.value.trim();
    if (!query) return;
    if (mode === "map") {
      searchResults = await fetchSearch(query);
      highlightedIds = new Set(searchResults.map(r => r.segment_id));
      updateParticleHighlights();
      animateCameraToHighlighted();
      render();
      return;
    }
    mode = "search";
    loading = true;
    render();
    searchResults = await fetchSearch(query);
    loading = false;
    filterOpen = false;
    render();
    centerCanvas();
  });

  document.getElementById("clear-search")?.addEventListener("click", () => {
    query = "";
    if (mode === "map") {
      searchResults = [];
      highlightedIds.clear();
      updateParticleHighlights();
      render();
      return;
    }
    mode = "browse";
    searchResults = [];
    render();
    centerCanvas();
  });

  document.getElementById("filter-toggle")?.addEventListener("click", () => {
    filterOpen = !filterOpen;
    render();
  });

  document.getElementById("map-toggle")?.addEventListener("click", async () => {
    if (mode === "map") {
      stopMapLoop();
      mode = "browse";
      render();
      centerCanvas();
      return;
    }
    mode = "map";
    loading = true;
    render();
    if (mapPoints.length === 0) {
      mapPoints = await fetchMap();
    }
    loading = false;
    render();
    await initMapGPU();
  });

  document.querySelectorAll(".filter-item input").forEach(cb => {
    cb.addEventListener("change", async (e) => {
      const el = e.target as HTMLInputElement;
      const col = el.dataset.collection!;
      if (el.checked) activeCollections.add(col);
      else activeCollections.delete(col);
      if (mode === "map") {
        updateParticleVisibility();
        return;
      }
      if (mode === "browse") {
        browseOffset = 0;
        await loadInitialSegments();
      } else if (mode === "search" && query) {
        searchResults = await fetchSearch(query);
        render();
      }
    });
  });

  if (mode !== "map") {
    document.querySelectorAll(".card").forEach(card => {
      card.querySelector("[data-action='play']")?.addEventListener("click", () => {
        if (dragMoved) return;
        const idx = parseInt((card as HTMLElement).dataset.idx!);
        const items = displaySegments();
        activeOverlay = items[idx];
        render();
      });

      card.querySelectorAll("[data-action='similar']").forEach(el => {
        el.addEventListener("click", async (e) => {
          if (dragMoved) return;
          e.stopPropagation();
          const segId = (el as HTMLElement).dataset.segmentId!;
          mode = "similar";
          query = "";
          loading = true;
          render();
          searchResults = await fetchSimilar(segId);
          loading = false;
          render();
          centerCanvas();
        });
      });
    });
  }

  if (activeOverlay) {
    const videoEl = document.getElementById("video-player") as HTMLVideoElement | null;
    if (videoEl && activeOverlay) {
      const seekTo = activeOverlay.start_seconds;
      videoEl.addEventListener("loadedmetadata", () => { videoEl.currentTime = seekTo; }, { once: true });
      new (window as any).Plyr(videoEl);
    }

    document.getElementById("overlay")?.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).id === "overlay") { activeOverlay = null; render(); }
    });
    document.getElementById("close-overlay")?.addEventListener("click", () => {
      activeOverlay = null; render();
    });
  }

  if (mode === "map") {
    const canvas = document.getElementById("map-canvas") as HTMLCanvasElement | null;
    if (canvas) {
      canvas.addEventListener("pointerdown", (e) => {
        if ((e.target as HTMLElement).closest(".top-bar")) return;
        if ((e.target as HTMLElement).closest(".overlay")) return;
        e.preventDefault();
        mapDragging = true;
        mapDragMoved = false;
        mapDragStartX = e.clientX;
        mapDragStartY = e.clientY;
        mapDragStartCamX = camX;
        mapDragStartCamY = camY;
      });
    }
  }
}

// ── WebGPU Particle System ──

interface ParticleField {
  name: string;
  type: "f32" | "u32" | "vec2" | "vec3" | "vec4";
}

const PARTICLE_FIELDS: ParticleField[] = [
  { name: "position", type: "vec2" },
  { name: "velocity", type: "vec2" },
  { name: "home", type: "vec2" },
  { name: "particle_size", type: "vec2" },
  { name: "color", type: "vec4" },
  { name: "highlighted", type: "f32" },
  { name: "visible", type: "f32" },
];

function fieldSize(type: string): number {
  switch (type) {
    case "f32": case "u32": return 4;
    case "vec2": return 8;
    case "vec3": return 12;
    case "vec4": return 16;
    default: return 4;
  }
}

function fieldAlign(type: string): number {
  switch (type) {
    case "f32": case "u32": return 4;
    case "vec2": return 8;
    case "vec3": return 16;
    case "vec4": return 16;
    default: return 4;
  }
}

function wgslType(type: string): string {
  switch (type) {
    case "f32": return "f32";
    case "u32": return "u32";
    case "vec2": return "vec2<f32>";
    case "vec3": return "vec3<f32>";
    case "vec4": return "vec4<f32>";
    default: return "f32";
  }
}

function computeParticleLayout(fields: ParticleField[]): { stride: number; offsets: Map<string, number>; wgsl: string } {
  let offset = 0;
  const offsets = new Map<string, number>();
  const lines: string[] = [];
  for (const f of fields) {
    const align = fieldAlign(f.type);
    offset = Math.ceil(offset / align) * align;
    offsets.set(f.name, offset);
    lines.push(`  ${f.name}: ${wgslType(f.type)},`);
    offset += fieldSize(f.type);
  }
  const structAlign = 16;
  const stride = Math.ceil(offset / structAlign) * structAlign;
  const wgsl = `struct Particle {\n${lines.join("\n")}\n}`;
  return { stride, offsets, wgsl };
}

const INPUTS_SIZE = 80;

const WGSL_PREAMBLE = `
  const PI: f32 = 3.14159265358979;
  const TAU: f32 = 6.28318530717959;

  fn sin01(x: f32) -> f32 { return sin(x) * 0.5 + 0.5; }
  fn clamp01(x: f32) -> f32 { return clamp(x, 0.0, 1.0); }
  fn one_minus(x: f32) -> f32 { return 1.0 - x; }
  fn map_range(v: f32, a: f32, b: f32, c: f32, d: f32) -> f32 { return c + (v - a) / (b - a) * (d - c); }
  fn map01(v: f32, a: f32, b: f32) -> f32 { return (v - a) / (b - a); }

  fn random(st: vec2<f32>) -> f32 {
    return fract(sin(dot(st, vec2(12.9898, 78.233))) * 43758.5453123);
  }

  fn rotate(v: vec2<f32>, angle: f32) -> vec2<f32> {
    let c = cos(angle);
    let s = sin(angle);
    return vec2(v.x * c - v.y * s, v.x * s + v.y * c);
  }

  fn rainbow_gradient(t: f32) -> vec3<f32> {
    return vec3(
      sin(t * TAU) * 0.5 + 0.5,
      sin((t + 0.333) * TAU) * 0.5 + 0.5,
      sin((t + 0.666) * TAU) * 0.5 + 0.5
    );
  }

  fn hsv2rgb(h: f32, s: f32, v: f32) -> vec3<f32> {
    let c = v * s;
    let hp = h * 6.0;
    let x = c * (1.0 - abs(hp % 2.0 - 1.0));
    var rgb: vec3<f32>;
    if (hp < 1.0) { rgb = vec3(c, x, 0.0); }
    else if (hp < 2.0) { rgb = vec3(x, c, 0.0); }
    else if (hp < 3.0) { rgb = vec3(0.0, c, x); }
    else if (hp < 4.0) { rgb = vec3(0.0, x, c); }
    else if (hp < 5.0) { rgb = vec3(x, 0.0, c); }
    else { rgb = vec3(c, 0.0, x); }
    let m = v - c;
    return rgb + m;
  }

  fn circle_sdf(p: vec2<f32>, r: f32) -> f32 {
    return length(p) - r;
  }

  fn perlin_fade(t: f32) -> f32 { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }
  fn perlin_noise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = vec2(perlin_fade(f.x), perlin_fade(f.y));
    let a = random(i);
    let b = random(i + vec2(1.0, 0.0));
    let c = random(i + vec2(0.0, 1.0));
    let d = random(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
  }
`;

function buildComputeShader(particleStruct: string, computeBody: string): string {
  return `${WGSL_PREAMBLE}
    ${particleStruct}

    struct Inputs {
      secs_since_start: f32,
      secs_since_last: f32,
      frame: u32,
      particle_count: u32,
      max_particles: u32,
      _pad: u32,
      mouse_abs: vec2<f32>,
      mouse_rel: vec2<f32>,
      resolution: vec2<f32>,
      camera: vec4<f32>,
    }

    @group(0) @binding(0) var<uniform> inputs: Inputs;
    @group(0) @binding(1) var<storage, read> particles_src: array<Particle>;
    @group(0) @binding(2) var<storage, read_write> counter: atomic<u32>;
    @group(0) @binding(3) var<storage, read_write> particles_dst: array<Particle>;

    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
      let idx = gid.x;
      if (idx >= inputs.particle_count) { return; }
      var p = particles_src[idx];
      let t = inputs.secs_since_start;
      let dt = inputs.secs_since_last;

      ${computeBody}

      particles_dst[idx] = p;
  }
`;
}

function buildRenderShader(particleStruct: string, fragmentBody: string): string {
  return `${WGSL_PREAMBLE}
    ${particleStruct}

    struct Inputs {
      secs_since_start: f32,
      secs_since_last: f32,
      frame: u32,
      particle_count: u32,
      max_particles: u32,
      _pad: u32,
      mouse_abs: vec2<f32>,
      mouse_rel: vec2<f32>,
      resolution: vec2<f32>,
      camera: vec4<f32>,
    }

    @group(0) @binding(0) var<uniform> inputs: Inputs;
    @group(0) @binding(1) var<storage, read> particles: array<Particle>;
    @group(0) @binding(2) var<storage, read> counter: u32;

    struct VSOut {
      @builtin(position) pos: vec4<f32>,
      @location(0) p_uv: vec2<f32>,
      @location(1) @interpolate(flat) idx: u32,
    }

    @vertex
    fn vs_main(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> VSOut {
      let quad = array<vec2<f32>, 6>(
        vec2(-0.5, -0.5), vec2(0.5, -0.5), vec2(-0.5, 0.5),
        vec2(-0.5, 0.5), vec2(0.5, -0.5), vec2(0.5, 0.5),
      );
      let uv = quad[vid] + 0.5;
      let p = particles[iid];

      if (p.visible < 0.5) {
        var out: VSOut;
        out.pos = vec4(0.0, 0.0, -2.0, 1.0);
        out.p_uv = uv;
        out.idx = iid;
        return out;
      }

      let cam = inputs.camera;
      let aspect = cam.w;
      let world = (p.position - cam.xy) * cam.z;
      let size = p.particle_size * cam.z / inputs.resolution;
      let screen = vec2(world.x / aspect, world.y) + quad[vid] * size;

      var out: VSOut;
      out.pos = vec4(screen * 2.0, 0.0, 1.0);
      out.p_uv = uv;
      out.idx = iid;
      return out;
    }

    @fragment
    fn fs_main(in: VSOut) -> @location(0) vec4<f32> {
      let idx = in.idx;
      let p = particles[idx];
      let p_uv = in.p_uv;
      let uv = in.pos.xy / inputs.resolution;
      let t = inputs.secs_since_start;
      let dt = inputs.secs_since_last;

      ${fragmentBody}
    }
  `;
}

const COMPUTE_BODY = `
  p.position += sin(t);
`;

const FRAGMENT_BODY = `
  let dist = length(p_uv - 0.5);
  let alpha = smoothstep(0.5, 0.3, dist);
  let glow = p.highlighted * sin01(t * 3.0 + f32(idx) * 0.1) * 0.3;
  return vec4(p.color.rgb + glow, alpha * p.color.a);
`;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

function collectionColor(col: string): [number, number, number] {
  if (!col) return [0.5, 0.5, 0.6];
  const h = (((hashString(col) % 360) + 360) % 360) / 360;
  const s = 0.5, v = 0.8;
  const c = v * s;
  const hp = h * 6;
  const x = c * (1 - Math.abs(hp % 2 - 1));
  let r = 0, g = 0, b = 0;
  if (hp < 1) { r = c; g = x; }
  else if (hp < 2) { r = x; g = c; }
  else if (hp < 3) { g = c; b = x; }
  else if (hp < 4) { g = x; b = c; }
  else if (hp < 5) { r = x; b = c; }
  else { r = c; b = x; }
  const m = v - c;
  return [r + m, g + m, b + m];
}

function buildParticleData(points: MapPoint[], layout: { stride: number; offsets: Map<string, number> }): Float32Array {
  const count = points.length;
  const f32PerParticle = layout.stride / 4;
  const data = new Float32Array(count * f32PerParticle);

  for (let i = 0; i < count; i++) {
    const base = i * f32PerParticle;
    const p = points[i];
    const posOff = layout.offsets.get("position")! / 4;
    const velOff = layout.offsets.get("velocity")! / 4;
    const homeOff = layout.offsets.get("home")! / 4;
    const sizeOff = layout.offsets.get("particle_size")! / 4;
    const colorOff = layout.offsets.get("color")! / 4;
    const hlOff = layout.offsets.get("highlighted")! / 4;
    const visOff = layout.offsets.get("visible")! / 4;

    const spread = 0.3;
    const cx = 0.5 + (Math.random() - 0.5) * spread;
    const cy = 0.5 + (Math.random() - 0.5) * spread;
    data[base + posOff] = cx;
    data[base + posOff + 1] = cy;
    data[base + velOff] = 0;
    data[base + velOff + 1] = 0;
    data[base + homeOff] = p.x;
    data[base + homeOff + 1] = p.y;
    data[base + sizeOff] = 8;
    data[base + sizeOff + 1] = 8;
    const [r, g, b] = collectionColor(p.collection);
    data[base + colorOff] = r;
    data[base + colorOff + 1] = g;
    data[base + colorOff + 2] = b;
    data[base + colorOff + 3] = 0.9;
    data[base + hlOff] = highlightedIds.has(p.segment_id) ? 1 : 0;
    data[base + visOff] = activeCollections.has(p.collection) ? 1 : 0;
  }
  return data;
}

async function initMapGPU() {
  const canvas = document.getElementById("map-canvas") as HTMLCanvasElement | null;
  if (!canvas || mapPoints.length === 0) return;

  canvas.width = window.innerWidth * devicePixelRatio;
  canvas.height = window.innerHeight * devicePixelRatio;
  canvas.style.width = "100%";
  canvas.style.height = "100%";

  if (!navigator.gpu) {
    console.error("WebGPU not supported");
    return;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return;
  const device = await adapter.requestDevice();

  const context = canvas.getContext("webgpu")!;
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: "premultiplied" });

  const layout = computeParticleLayout(PARTICLE_FIELDS);
  const particleData = buildParticleData(mapPoints, layout);
  const bufSize = particleData.byteLength;

  const particleBufA = device.createBuffer({ size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: "particles_a" });
  const particleBufB = device.createBuffer({ size: bufSize, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, label: "particles_b" });
  device.queue.writeBuffer(particleBufA, 0, particleData);
  device.queue.writeBuffer(particleBufB, 0, particleData);

  const counterBuf = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
  device.queue.writeBuffer(counterBuf, 0, new Uint32Array([mapPoints.length]));

  const inputsBuf = device.createBuffer({ size: INPUTS_SIZE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });

  const computeBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
    ],
  });

  const renderBindGroupLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      { binding: 1, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
      { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "read-only-storage" } },
    ],
  });

  const computeShaderCode = buildComputeShader(layout.wgsl, COMPUTE_BODY);
  const computeModule = device.createShaderModule({ code: computeShaderCode });
  const computePipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [computeBindGroupLayout] }),
    compute: { module: computeModule, entryPoint: "main" },
  });

  const renderShaderCode = buildRenderShader(layout.wgsl, FRAGMENT_BODY);
  const renderModule = device.createShaderModule({ code: renderShaderCode });
  const renderPipeline = device.createRenderPipeline({
    layout: device.createPipelineLayout({ bindGroupLayouts: [renderBindGroupLayout] }),
    vertex: { module: renderModule, entryPoint: "vs_main" },
    fragment: {
      module: renderModule,
      entryPoint: "fs_main",
      targets: [{
        format,
        blend: {
          color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
          alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
        },
      }],
    },
    primitive: { topology: "triangle-list" },
  });

  const computeBindGroups: [GPUBindGroup, GPUBindGroup] = [
    device.createBindGroup({
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputsBuf } },
        { binding: 1, resource: { buffer: particleBufA } },
        { binding: 2, resource: { buffer: counterBuf } },
        { binding: 3, resource: { buffer: particleBufB } },
      ],
    }),
    device.createBindGroup({
      layout: computeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputsBuf } },
        { binding: 1, resource: { buffer: particleBufB } },
        { binding: 2, resource: { buffer: counterBuf } },
        { binding: 3, resource: { buffer: particleBufA } },
      ],
    }),
  ];

  const renderBindGroups: [GPUBindGroup, GPUBindGroup] = [
    device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputsBuf } },
        { binding: 1, resource: { buffer: particleBufB } },
        { binding: 2, resource: { buffer: counterBuf } },
      ],
    }),
    device.createBindGroup({
      layout: renderBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: inputsBuf } },
        { binding: 1, resource: { buffer: particleBufA } },
        { binding: 2, resource: { buffer: counterBuf } },
      ],
    }),
  ];

  const now = performance.now() / 1000;
  gpu = {
    device, context,
    computePipeline, renderPipeline,
    particleBufs: [particleBufA, particleBufB],
    counterBuf, inputsBuf,
    computeBindGroups, renderBindGroups,
    particleCount: mapPoints.length,
    frame: 0,
    startTime: now,
    lastTime: now,
    pingpong: 0,
    raf: 0,
  };

  camX = 0.5; camY = 0.5; camZoom = 1.0;
  camTargetX = 0.5; camTargetY = 0.5; camTargetZoom = 1.0;

  startMapLoop();
}

function startMapLoop() {
  if (!gpu) return;
  function frame() {
    if (!gpu || mode !== "map") return;
    renderMapFrame();
    gpu.raf = requestAnimationFrame(frame);
  }
  gpu.raf = requestAnimationFrame(frame);
}

function stopMapLoop() {
  if (gpu) {
    cancelAnimationFrame(gpu.raf);
  }
}

function renderMapFrame() {
  if (!gpu) return;
  const { device, context, computePipeline, renderPipeline, inputsBuf, particleCount } = gpu;

  const canvas = document.getElementById("map-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;

  const dpr = devicePixelRatio;
  const w = Math.floor(canvas.clientWidth * dpr);
  const h = Math.floor(canvas.clientHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }

  const now = performance.now() / 1000;
  const dt = Math.min(now - gpu.lastTime, 0.05);
  gpu.lastTime = now;
  const t = now - gpu.startTime;

  const lerpSpeed = 1 - Math.pow(0.001, dt);
  camX += (camTargetX - camX) * lerpSpeed;
  camY += (camTargetY - camY) * lerpSpeed;
  camZoom += (camTargetZoom - camZoom) * lerpSpeed;

  const aspect = canvas.width / canvas.height;
  const mouseRelX = mapMouseX / canvas.clientWidth;
  const mouseRelY = mapMouseY / canvas.clientHeight;

  const inputsData = new ArrayBuffer(INPUTS_SIZE);
  const f32 = new Float32Array(inputsData);
  const u32 = new Uint32Array(inputsData);
  f32[0] = t;
  f32[1] = dt;
  u32[2] = gpu.frame;
  u32[3] = particleCount;
  u32[4] = particleCount;
  u32[5] = 0;
  f32[6] = mapMouseX;
  f32[7] = mapMouseY;
  f32[8] = mouseRelX;
  f32[9] = mouseRelY;
  f32[10] = canvas.width;
  f32[11] = canvas.height;
  f32[12] = camX;
  f32[13] = camY;
  f32[14] = camZoom;
  f32[15] = aspect;
  // _pad2 at f32[16..17]
  // Additional padding fills to 80 bytes (20 f32s)
  device.queue.writeBuffer(inputsBuf, 0, inputsData);

  const encoder = device.createCommandEncoder();

  const pp = gpu.pingpong;
  const computePass = encoder.beginComputePass();
  computePass.setPipeline(computePipeline);
  computePass.setBindGroup(0, gpu.computeBindGroups[pp]);
  computePass.dispatchWorkgroups(Math.ceil(particleCount / 256));
  computePass.end();

  const tex = context.getCurrentTexture();
  const renderPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: tex.createView(),
      clearValue: { r: 0.04, g: 0.04, b: 0.04, a: 1 },
      loadOp: "clear",
      storeOp: "store",
    }],
  });
  renderPass.setPipeline(renderPipeline);
  renderPass.setBindGroup(0, gpu.renderBindGroups[pp]);
  renderPass.draw(6, particleCount);
  renderPass.end();

  device.queue.submit([encoder.finish()]);

  gpu.pingpong = 1 - pp;
  gpu.frame++;
}

function updateParticleHighlights() {
  if (!gpu || mapPoints.length === 0) return;
  const layout = computeParticleLayout(PARTICLE_FIELDS);
  const hlOffset = layout.offsets.get("highlighted")!;
  const stride = layout.stride;

  const buf = new Float32Array(mapPoints.length);
  for (let i = 0; i < mapPoints.length; i++) {
    buf[i] = highlightedIds.has(mapPoints[i].segment_id) ? 1 : 0;
  }

  const fullData = new ArrayBuffer(mapPoints.length * stride);
  const src = gpu.pingpong === 0 ? gpu.particleBufs[0] : gpu.particleBufs[1];

  for (let i = 0; i < mapPoints.length; i++) {
    const view = new DataView(fullData, i * stride + hlOffset, 4);
    view.setFloat32(0, buf[i], true);
  }

  for (let i = 0; i < mapPoints.length; i++) {
    gpu.device.queue.writeBuffer(gpu.particleBufs[0], i * stride + hlOffset, new Float32Array([buf[i]]));
    gpu.device.queue.writeBuffer(gpu.particleBufs[1], i * stride + hlOffset, new Float32Array([buf[i]]));
  }
}

function updateParticleVisibility() {
  if (!gpu || mapPoints.length === 0) return;
  const layout = computeParticleLayout(PARTICLE_FIELDS);
  const visOffset = layout.offsets.get("visible")!;
  const stride = layout.stride;

  for (let i = 0; i < mapPoints.length; i++) {
    const val = activeCollections.has(mapPoints[i].collection) ? 1 : 0;
    gpu.device.queue.writeBuffer(gpu.particleBufs[0], i * stride + visOffset, new Float32Array([val]));
    gpu.device.queue.writeBuffer(gpu.particleBufs[1], i * stride + visOffset, new Float32Array([val]));
  }
}

function animateCameraToHighlighted() {
  if (highlightedIds.size === 0) return;
  let sx = 0, sy = 0, n = 0;
  for (const p of mapPoints) {
    if (highlightedIds.has(p.segment_id)) {
      sx += p.x;
      sy += p.y;
      n++;
    }
  }
  if (n === 0) return;
  camTargetX = sx / n;
  camTargetY = sy / n;
  camTargetZoom = Math.max(1.5, camZoom);
}

function handleMapClick(screenX: number, screenY: number) {
  if (!gpu || mapPoints.length === 0) return;
  const canvas = document.getElementById("map-canvas") as HTMLCanvasElement | null;
  if (!canvas) return;

  const rect = canvas.getBoundingClientRect();
  const aspect = canvas.width / canvas.height;
  const px = (screenX - rect.left) / rect.height;
  const py = (screenY - rect.top) / rect.height;
  const worldX = camX + (px - 0.5 * aspect) / camZoom;
  const worldY = camY + (py - 0.5) / camZoom;

  let bestDist = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < mapPoints.length; i++) {
    if (!activeCollections.has(mapPoints[i].collection)) continue;
    const dx = mapPoints[i].x - worldX;
    const dy = mapPoints[i].y - worldY;
    const d = dx * dx + dy * dy;
    if (d < bestDist) {
      bestDist = d;
      bestIdx = i;
    }
  }

  const clickRadius = 12 / (canvas.height * camZoom);
  if (bestIdx >= 0 && bestDist < clickRadius * clickRadius) {
    const segId = mapPoints[bestIdx].segment_id;
    fetch(`/search?segment_id=${encodeURIComponent(segId)}&n=1`)
      .then(r => r.json())
      .then((data: SearchResponse) => {
        if (data.results.length > 0) {
          activeOverlay = data.results[0];
          render();
          if (gpu && mode === "map") startMapLoop();
        }
      });
  }
}

async function init() {
  setupDragListeners();
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (activeOverlay) { activeOverlay = null; render(); if (mode === "map" && gpu) startMapLoop(); }
      else if (mode === "map") { stopMapLoop(); mode = "browse"; render(); centerCanvas(); }
      else if (filterOpen) { filterOpen = false; render(); }
    }
  });
  document.addEventListener("pointerdown", (e) => {
    if (!filterOpen) return;
    const panel = document.querySelector(".filter-panel");
    const toggle = document.getElementById("filter-toggle");
    if (panel?.contains(e.target as Node) || toggle?.contains(e.target as Node)) return;
    filterOpen = false;
    render();
  });
  collections = await fetchCollections();
  activeCollections = new Set(collections.map(c => c.id));
  await loadInitialSegments();
}

document.addEventListener("DOMContentLoaded", init);
