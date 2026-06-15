"""Curated demo sentences chosen to show off the visualization:
reordering (adjective order, SOV languages), multiple phrase types
(concept / action / time / connector), and a spread of languages.

Each entry: (source_text, source_lang, target_lang).
The API only serves examples whose languages are currently supported.
"""
import config

try:
    from examples_cache import CACHE as _CACHE
except Exception:  # cache not generated yet
    _CACHE = {}

# Curated set — one per language, chosen to show reordering + phrase types.
# Decompositions are authored by a large model (see build_examples.py), not the
# small on-device model, so the examples are reliably correct.
EXAMPLES = [
    ("The small red car drove quickly yesterday", "English", "French"),
    ("Every morning she drinks hot coffee in the garden", "English", "Spanish"),
    ("The old man told a beautiful story to the children", "English", "Italian"),
    ("They traveled to the mountains during the summer", "English", "Portuguese"),
    ("She will visit her grandmother next weekend", "English", "German"),
    ("The scientist explained her discovery very clearly", "English", "Russian"),
    ("We are learning three new languages together", "English", "Korean"),
    ("I read a book about history yesterday", "English", "Japanese"),
    ("我每天早上喝一杯热咖啡", "Chinese", "English"),
    ("Le petit chat noir dort sur le vieux canapé", "French", "English"),
]


def _key(text, src, tgt):
    return f"{src}|{tgt}|{text}"


def available():
    """Examples whose source+target languages are both supported right now."""
    langs = set(config.LANGUAGES)
    out = []
    for text, src, tgt in EXAMPLES:
        if src in langs and tgt in langs:
            out.append({"text": text, "source": src, "target": tgt})
    return out


def cached_results():
    """Precomputed full translation results for supported examples.

    These let the UI load an example with NO LLM call. Returns the same JSON
    shape as /api/translate.
    """
    langs = set(config.LANGUAGES)
    out = []
    for text, src, tgt in EXAMPLES:
        if src in langs and tgt in langs:
            r = _CACHE.get(_key(text, src, tgt))
            if r:
                out.append(r)
    return out
