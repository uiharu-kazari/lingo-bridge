import { CardsView } from "/static/view3d.js?v=21";

// ---- shared colour helpers (purple -> cyan) --------------------------------
export const SRC_RGB = [168, 85, 247];
export const TGT_RGB = [31, 224, 208];
export function mixRGB(t) {
  t = Math.max(0, Math.min(1, t));
  return SRC_RGB.map((s, i) => Math.round(s + (TGT_RGB[i] - s) * t));
}
export function mixCss(t, a = 1) {
  const [r, g, b] = mixRGB(t);
  return `rgba(${r},${g},${b},${a})`;
}

const $ = (s) => document.querySelector(s);
const state = {
  data: null,
  cards: null,
  hover: null,
  playing: false,
};

// ---- bootstrap -------------------------------------------------------------
async function boot() {
  const st = await fetch("/api/status").then((r) => r.json());
  $("#badge-llm").textContent = "LLM: " + (st.llm_label || st.llm_backend);
  $("#badge-tts").textContent = "TTS: " + (st.tts_label || st.tts_backend);

  const src = $("#source"), tgt = $("#target");
  st.languages.forEach((l) => {
    src.add(new Option(l, l));
    tgt.add(new Option(l, l));
  });
  src.value = "English";
  tgt.value = st.languages.includes("Spanish") ? "Spanish" : st.languages[1];

  state.cards = new CardsView($("#view-cards"), hooks);
  window.__cards = state.cards; // debug hook for layout inspection

  $("#go").onclick = run;
  $("#input").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") run();
  });
  $("#swap").onclick = () => {
    const a = src.value; src.value = tgt.value; tgt.value = a;
  };

  // Load a random curated example. Uses a precomputed result when available,
  // so this renders instantly with NO LLM call (falls back to live translate).
  $("#example").onclick = async () => {
    try {
      const data = await fetch("/api/examples?random=true").then((r) => r.json());
      if (data.result) {
        const result = data.result;
        $("#input").value = result.source_text;
        src.value = result.source_lang;
        tgt.value = result.target_lang;
        $("#hint").classList.add("hidden");
        updateControlsState();
        state.data = result;
        state.cards.render(result);
      } else if (data.example) {
        $("#input").value = data.example.text;
        src.value = data.example.source;
        tgt.value = data.example.target;
        run();
      }
    } catch (e) {
      console.error("example load failed", e);
    }
  };

  // Perspective control wires
  const slider = $("#perspective-slider");
  slider.oninput = (e) => {
    const val = parseFloat(e.target.value);
    state.cards.setPerspective(val, false);
  };


  const zoomSlider = $("#zoom-slider");
  zoomSlider.oninput = (e) => {
    const val = parseFloat(e.target.value);
    state.cards.setZoom(val);
  };
  $("#btn-zoom-in").onclick = () => {
    state.cards.zoomIn();
  };
  $("#btn-zoom-out").onclick = () => {
    state.cards.zoomOut();
  };
  $("#btn-rotate-left").onclick = () => {
    state.cards.rotateLeft();
  };
  $("#btn-rotate-right").onclick = () => {
    state.cards.rotateRight();
  };
  $("#btn-move-forward").onclick = () => {
    state.cards.moveForward();
  };
  $("#btn-move-backward").onclick = () => {
    state.cards.moveBackward();
  };

  $("#playall").onclick = playAll;
  updateControlsState();
}

function updateControlsState() {
  const isWelcome = !$("#hint").classList.contains("hidden");
  
  if (state.cards) {
    state.cards.setControlsEnabled(!isWelcome);
  }
  
  const pSlider = $("#perspective-slider");
  if (pSlider) pSlider.disabled = isWelcome;
  
  const playAllBtn = $("#playall");
  if (playAllBtn) playAllBtn.disabled = isWelcome;

  const zoomSlider = $("#zoom-slider");
  if (zoomSlider) zoomSlider.disabled = isWelcome;

  document.querySelectorAll(".zoom-controls button").forEach((btn) => {
    btn.disabled = isWelcome;
  });
  
  const pControl = $(".perspective-control");
  const zoomControls = $(".zoom-controls");
  
  if (isWelcome) {
    if (pControl) { pControl.style.opacity = "0.35"; pControl.style.pointerEvents = "none"; }
    if (playAllBtn) { playAllBtn.style.opacity = "0.35"; playAllBtn.style.pointerEvents = "none"; }
    if (zoomControls) { zoomControls.style.opacity = "0.25"; zoomControls.style.pointerEvents = "none"; }
  } else {
    if (pControl) { pControl.style.opacity = "1"; pControl.style.pointerEvents = "auto"; }
    if (playAllBtn) { playAllBtn.style.opacity = "1"; playAllBtn.style.pointerEvents = "auto"; }
    if (zoomControls) { zoomControls.style.opacity = "1"; zoomControls.style.pointerEvents = "auto"; }
  }
}

const hooks = {
  onHover: (unit) => {
    state.hover = unit;
    state.cards.setHover(unit);
  },
  onPlay: (layerIdx) => {
    if (state.playing) stopPlaying();
    playLayer(layerIdx);
  },
  onPerspectiveChange: (t) => {
    // Called by CardsView when animating perspective automatically
    const slider = $("#perspective-slider");
    slider.value = t;
  },
  onZoomChange: (t) => {
    const zoomSlider = $("#zoom-slider");
    if (zoomSlider) {
      zoomSlider.value = t;
    }
  }
};

async function run() {
  const text = $("#input").value.trim();
  if (!text) return;
  $("#hint").classList.add("hidden");
  updateControlsState();
  showLoader(true, "Decomposing & aligning phrases…");
  try {
    const data = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        source: $("#source").value,
        target: $("#target").value,
      }),
    }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
    state.data = data;
    state.cards.render(data);
  } catch (e) {
    alert("Translation failed: " + e.message);
  } finally {
    showLoader(false);
  }
}

function showLoader(on, msg) {
  $("#loader").classList.toggle("hidden", !on);
  if (msg) $("#loadmsg").textContent = msg;
}

// ---- audio -----------------------------------------------------------------
const player = $("#player");
let currentPlayResolve = null;

function langForLayer(idx) {
  if (!state.data) return "English";
  return idx === 0 ? state.data.source_lang : state.data.target_lang;
}
async function ttsUrl(text, lang) {
  const r = await fetch("/api/tts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, lang }),
  }).then((r) => r.json());
  return r.url;
}
async function playLayer(idx) {
  if (!state.data) return;
  
  if (currentPlayResolve) {
    currentPlayResolve();
    currentPlayResolve = null;
  }
  
  const layer = state.data.layers[idx];
  highlightLayer(idx);
  // Precomputed examples ship per-layer audio -> play instantly, no TTS call.
  const url = layer.audio || (await ttsUrl(layer.text, langForLayer(idx)));
  player.src = url;
  await player.play().catch(() => {});
  return new Promise((res) => {
    currentPlayResolve = res;
    player.onended = () => {
      currentPlayResolve = null;
      if (!state.playing) {
        highlightLayer(-1);
      }
      res();
    };
  });
}
function highlightLayer(idx) {
  state.cards.highlightLayer(idx);
}
function stopPlaying() {
  state.playing = false;
  player.pause();
  player.src = "";
  if (currentPlayResolve) {
    currentPlayResolve();
    currentPlayResolve = null;
  }
  $("#playall").classList.remove("playing");
  $("#playall").textContent = "▶ Play all layers";
  highlightLayer(-1);
}
async function playAll() {
  if (!state.data) return;
  if (state.playing) {
    stopPlaying();
    return;
  }
  
  state.playing = true;
  $("#playall").classList.add("playing");
  $("#playall").textContent = "■ Stop playing";
  for (let i = 0; i < state.data.layers.length; i++) {
    if (!state.playing) break;
    await playLayer(i);
  }
  
  if (state.playing) {
    state.playing = false;
    $("#playall").classList.remove("playing");
    $("#playall").textContent = "▶ Play all layers";
    highlightLayer(-1);
  }
}

boot();
