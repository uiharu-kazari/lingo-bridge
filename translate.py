"""Progressive translation engine.

Strategy (keeps JSON simple + guarantees valid phrase links):

1. ONE structured LLM call decomposes the source sentence into aligned phrase
   "units". Each unit knows its source text, target text, a semantic TYPE, and
   where it lands in the natural target word order.
2. Python deterministically builds the seven progressive layers from those
   units: phrases flip to the target language by TYPE (so related phrases move
   together, never random words), and word order migrates toward the target
   near the end (producing elegant crossing ribbons).
3. Links connect the SAME unit across adjacent layers, so every link is valid
   by construction and reordering is visible as crossings.
"""
from __future__ import annotations
import re
import config
import llm

VALID_TYPES = set(config.FLIP_SCHEDULE.keys())

SYSTEM = (
    "You are a precise translation analyst. You break a sentence into meaningful "
    "phrase units and align them to their natural translation. You ALWAYS reply "
    "with a single JSON object and nothing else."
)

USER_TMPL = """Analyze this {src} sentence and align it to {tgt}.

Sentence: "{text}"

Return JSON shaped exactly like:
{{
  "final": "<the full, natural {tgt} translation of the whole sentence>",
  "units": [
    {{"source": "<short phrase in {src}>",
      "target": "<its {tgt} translation>",
      "type": "<concept|action|time|connector|other>",
      "order_target": <0-based position of this phrase in the {tgt} sentence>}}
  ]
}}

Rules:
- Split into 3-7 SHORT meaningful phrases (noun phrases, verb phrases, time
  expressions, connectors). Keep "source" phrases in their original order.
- type: "concept" = people/things/ideas (nouns); "action" = verbs/feelings;
  "time" = when/time/context words; "connector" = and/but/of/grammar words;
  "other" = anything else.
- order_target: where each phrase appears in the natural {tgt} translation
  (the {tgt} word order may differ from {src}). Values are a permutation of
  0..N-1.
- Cover the whole sentence. Reply with ONLY the JSON object."""


def _clean(s: str) -> str:
    return re.sub(r"\s+", " ", str(s)).strip()


def _decompose(text: str, src: str, tgt: str) -> dict:
    user = USER_TMPL.format(src=src, tgt=tgt, text=text)
    data = llm.chat_json(SYSTEM, user, max_tokens=1200)
    return _validate(data, text, tgt)


def _validate(data: dict, text: str, tgt: str) -> dict:
    units = data.get("units") or []
    clean = []
    for u in units:
        s = _clean(u.get("source", ""))
        t = _clean(u.get("target", ""))
        if not s or not t:
            continue
        typ = str(u.get("type", "other")).lower().strip()
        if typ not in VALID_TYPES:
            typ = "other"
        try:
            ot = int(u.get("order_target"))
        except (TypeError, ValueError):
            ot = len(clean)
        clean.append({"source": s, "target": t, "type": typ, "order_target": ot})
    if not clean:
        raise ValueError("no valid units returned")
    # Normalise order_target into a clean permutation by rank.
    ranked = sorted(range(len(clean)), key=lambda i: clean[i]["order_target"])
    for pos, idx in enumerate(ranked):
        clean[idx]["order_target"] = pos
    final = _clean(data.get("final", "")) or " ".join(
        clean[i]["target"] for i in ranked
    )
    return {"final": final, "units": clean, "source_text": _clean(text)}


# ----------------------------------------------------------------------------
# Mock backend: deterministic decomposition so the app works with no model.
# ----------------------------------------------------------------------------
_MOCK_DICT = {
    ("English", "Spanish"): {
        "the": "el", "cat": "gato", "sat": "se sentó", "on": "en",
        "mat": "tapete", "i": "yo", "love": "amo", "you": "te",
        "good": "buen", "morning": "días", "we": "nosotros",
        "will": "", "eat": "comeremos", "later": "más tarde",
    },
}


def _mock_decompose(text: str, src: str, tgt: str) -> dict:
    words = re.findall(r"[^\s]+", text)
    d = _MOCK_DICT.get((src, tgt), {})
    units = []
    for i, w in enumerate(words):
        key = re.sub(r"[^\w]", "", w).lower()
        tgt_w = d.get(key, key[::-1] if key else w)
        typ = ["concept", "action", "time", "connector", "other"][i % 5]
        units.append(
            {"source": w, "target": tgt_w or w, "type": typ, "order_target": i}
        )
    final = " ".join(u["target"] for u in units)
    return {"final": final, "units": units, "source_text": text}


# ----------------------------------------------------------------------------
# Build the seven layers + adjacency links from aligned units.
# ----------------------------------------------------------------------------
def _flip_layer(unit_type: str) -> int:
    """Layer index at which this unit type switches to the target language."""
    return config.FLIP_SCHEDULE.get(unit_type, config.FLIP_SCHEDULE["other"])


def _occurrence_order(units, field, full_text, fallback):
    """Order unit indices by where each phrase actually appears in `full_text`,
    so the endpoint layers read as real, grammatical sentences. Phrases that
    aren't found fall back to the LLM-provided order, after the found ones."""
    full = (full_text or "").lower()
    pos = []
    for u in units:
        phrase = (u.get(field) or "").lower().strip()
        pos.append(full.find(phrase) if phrase else -1)
    return sorted(
        range(len(units)),
        key=lambda i: (pos[i], i) if pos[i] >= 0 else (10**9 + fallback(i), i),
    )


def build_layers(decomp: dict, src: str, tgt: str) -> dict:
    units = decomp["units"]
    n = len(units)
    # Beginning must read as the source sentence; end as the natural target
    # sentence. Derive both from the actual sentences rather than trusting the
    # order the model listed phrases in. The middle is free to rearrange.
    source_order = _occurrence_order(
        units, "source", decomp.get("source_text", ""), lambda i: i
    )
    target_order = _occurrence_order(
        units, "target", decomp.get("final", ""), lambda i: units[i]["order_target"]
    )

    layers = []
    for L, label in enumerate(config.LAYER_LABELS):
        # Word order: source order until REORDER_AT, then target order.
        if L >= config.REORDER_AT:
            order = target_order
        else:
            order = source_order

        chunks = []
        for pos, ui in enumerate(order):
            u = units[ui]
            flip = _flip_layer(u["type"])
            if L == 0:
                text, mix, lang = u["source"], 0.0, "source"
            elif L == len(config.LAYER_LABELS) - 1:
                text, mix, lang = u["target"], 1.0, "target"
            elif L < flip:
                text, mix, lang = u["source"], 0.0, "source"
            elif L == flip:
                text, mix, lang = u["target"], 0.5, "mixed"  # just flipped
            else:
                text, mix, lang = u["target"], 1.0, "target"
            chunks.append(
                {
                    "id": f"l{L}u{ui}",
                    "unit": ui,
                    "text": text,
                    "mix": mix,
                    "lang": lang,
                    "pos": pos,
                }
            )
        layer_mix = sum(c["mix"] for c in chunks) / max(1, len(chunks))
        layers.append(
            {
                "index": L,
                "label": label,
                "text": " ".join(c["text"] for c in chunks),
                "mix": round(layer_mix, 3),
                "chunks": chunks,
            }
        )

    # Endpoint layers speak the exact source / natural-target sentences.
    if decomp.get("source_text"):
        layers[0]["text"] = decomp["source_text"]
    layers[-1]["text"] = decomp["final"]

    # Links: same unit across adjacent layers.
    links = []
    for L in range(len(layers) - 1):
        a = {c["unit"]: c for c in layers[L]["chunks"]}
        b = {c["unit"]: c for c in layers[L + 1]["chunks"]}
        for ui, ca in a.items():
            cb = b.get(ui)
            if not cb:
                continue
            if ca["pos"] != cb["pos"]:
                kind = "reorder"
            elif ca["mix"] != cb["mix"]:
                kind = "translate"
            else:
                kind = "keep"
            links.append(
                {"from": ca["id"], "to": cb["id"], "unit": ui, "kind": kind}
            )
    return {
        "source_lang": src,
        "target_lang": tgt,
        "source_text": layers[0]["text"],
        "final_text": layers[-1]["text"],
        "n_units": n,
        "layers": layers,
        "links": links,
    }


def _remote_translate(text: str, src: str, tgt: str) -> dict:
    """Proxy the whole translation to a deployed (Modal) instance — no local
    model. Layer-building happens there too, so the result is identical.
    Retries once to absorb the deployed container's cold-start blip."""
    import json
    import time
    import urllib.request
    base = llm.REMOTE.rstrip("/")
    payload = json.dumps({"text": text, "source": src, "target": tgt}).encode("utf-8")
    last = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(
                base + "/api/translate", data=payload,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=15) as r:  # fast fallback if slow
                return json.load(r)
        except Exception as e:
            last = e
            if attempt == 0:
                time.sleep(4)
    raise last


def progressive_translate(text: str, src: str, tgt: str) -> dict:
    text = _clean(text)
    if not text:
        raise ValueError("empty input")
    if llm.REMOTE:
        try:
            return _remote_translate(text, src, tgt)
        except Exception as e:
            print(f"[translate] remote translate failed ({e}); falling back to mock")
            decomp = _mock_decompose(text, src, tgt)
    elif llm.backend() == "llama":
        try:
            decomp = _decompose(text, src, tgt)
        except Exception as e:
            print(f"[translate] LLM decompose failed ({e}); retrying once")
            try:
                decomp = _decompose(text, src, tgt)
            except Exception as e2:
                print(f"[translate] retry failed ({e2}); using mock")
                decomp = _mock_decompose(text, src, tgt)
    else:
        decomp = _mock_decompose(text, src, tgt)
    return build_layers(decomp, src, tgt)


if __name__ == "__main__":
    import json as _j
    r = progressive_translate("The cat sat on the mat", "English", "Spanish")
    print(_j.dumps(r, indent=2, ensure_ascii=False))
