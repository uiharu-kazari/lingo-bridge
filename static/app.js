import { CardsView } from "/static/view3d.js";

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
}

const hooks = {
  onHover: (unit) => {
    state.hover = unit;
    state.cards.setHover(unit);
  },
  onPlay: (layerIdx) => playLayer(layerIdx),
  onPerspectiveChange: (t) => {
    // Called by CardsView when animating perspective automatically
    const slider = $("#perspective-slider");
    slider.value = t;
  }
};

async function run() {
  const text = $("#input").value.trim();
  if (!text) return;
  $("#hint").classList.add("hidden");
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
  const layer = state.data.layers[idx];
  highlightLayer(idx);
  // Precomputed examples ship per-layer audio -> play instantly, no TTS call.
  const url = layer.audio || (await ttsUrl(layer.text, langForLayer(idx)));
  player.src = url;
  await player.play().catch(() => {});
  return new Promise((res) => (player.onended = res));
}
function highlightLayer(idx) {
  state.cards.highlightLayer(idx);
}
async function playAll() {
  if (!state.data || state.playing) return;
  state.playing = true;
  $("#playall").classList.add("playing");
  $("#playall").textContent = "■ Playing…";
  for (let i = 0; i < state.data.layers.length; i++) {
    if (!state.playing) break;
    await playLayer(i);
  }
  state.playing = false;
  $("#playall").classList.remove("playing");
  $("#playall").textContent = "▶ Play all layers";
  highlightLayer(-1);
}

boot();
