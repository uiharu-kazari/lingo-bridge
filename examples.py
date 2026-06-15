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

EXAMPLES = [
    # adjective reorder -> crossing ribbons
    ("The small red car drove quickly yesterday", "English", "French"),
    # SOV reorder: verb jumps to the end, time word to the front
    ("I read a book about history yesterday", "English", "Japanese"),
    # rich time + place + action
    ("Every morning she drinks hot coffee in the garden", "English", "Spanish"),
    ("The old man told a beautiful story to the children", "English", "Italian"),
    ("They traveled to the mountains during the summer", "English", "Portuguese"),
    ("She sings a beautiful song every evening", "English", "Hindi"),
    ("We will meet our friends at the station tomorrow", "English", "French"),
    ("The quiet teacher explained the difficult lesson patiently", "English", "Spanish"),
    # newer Qwen3-TTS languages
    ("She will visit her grandmother next weekend", "English", "German"),
    ("We are learning three new languages together", "English", "Korean"),
    ("The scientist explained her discovery very clearly", "English", "Russian"),
    # non-English sources
    ("我每天早上喝一杯热咖啡", "Chinese", "English"),
    ("Le petit chat noir dort sur le vieux canapé", "French", "English"),
    ("私は昨日友達と公園で遊びました", "Japanese", "English"),
    ("Mi hermana cocina una cena deliciosa los domingos", "Spanish", "English"),
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
