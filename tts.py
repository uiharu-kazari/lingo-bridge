"""Text-to-speech for each translation layer.

Default engine: Kokoro-82M via onnxruntime (Apache-2.0, multilingual, runs on
CPU/Apple-Silicon with no GPU). A Qwen3-TTS adapter slot is documented but
disabled because Qwen3-TTS-0.6B ships CUDA-only inference with no MPS path.

Audio is written to audio_cache/ and addressed by a content hash so repeated
requests are instant.
"""
from __future__ import annotations
import hashlib
import os
import wave
import struct
import config

# Engine selection. Default "kokoro" (runs anywhere, incl. Apple Silicon).
# TTS_ENGINE=qwen3 uses Qwen3-TTS-12Hz-1.7B-CustomVoice via `qwen-tts` (needs an
# NVIDIA GPU); it falls back to Kokoro if it can't load.
ENGINE = os.environ.get("TTS_ENGINE", "kokoro").lower()

_kokoro = None
_qwen3 = None
_backend = None  # "kokoro" | "qwen3" | "beep"


def _load():
    global _kokoro, _qwen3, _backend
    if _backend is not None:
        return
    if ENGINE == "remote":
        _backend = "remote"
        print(f"[tts] proxying TTS to {config.TTS_REMOTE_URL}")
        return
    if ENGINE == "qwen3":
        try:                                    # pragma: no cover (needs CUDA)
            import torch
            from qwen_tts import Qwen3TTSModel
            src = (str(config.QWEN3_TTS_DIR)
                   if config.QWEN3_TTS_DIR.exists() else config.QWEN3_TTS_REPO)
            _qwen3 = Qwen3TTSModel.from_pretrained(
                src, device_map="cuda:0", dtype=torch.bfloat16,
                attn_implementation=config.QWEN3_ATTN,
            )
            _backend = "qwen3"
            print(f"[tts] loaded Qwen3-TTS CustomVoice ({config.QWEN3_ATTN}) "
                  f"speaker={config.QWEN3_SPEAKER}")
            return
        except Exception as e:                  # pragma: no cover
            print(f"[tts] Qwen3-TTS unavailable ({e}); falling back to Kokoro")
    if config.KOKORO_MODEL.exists() and config.KOKORO_VOICES.exists():
        try:
            from kokoro_onnx import Kokoro
            _kokoro = Kokoro(str(config.KOKORO_MODEL), str(config.KOKORO_VOICES))
            _backend = "kokoro"
            print("[tts] loaded Kokoro-82M (onnxruntime)")
            return
        except Exception as e:  # pragma: no cover
            print(f"[tts] kokoro load failed ({e}); using beep fallback")
    else:
        print("[tts] kokoro assets missing; using beep fallback")
    _backend = "beep"


def backend() -> str:
    _load()
    return _backend


def _voice_for(lang_name: str):
    _, lang_code, voice = config.LANGUAGES.get(
        lang_name, ("en", "en-us", config.DEFAULT_VOICE)
    )
    return lang_code, voice


def _cache_path(text: str, lang_name: str) -> "config.Path":
    key = hashlib.sha1(f"{backend()}|{lang_name}|{text}".encode("utf-8")).hexdigest()[:16]
    config.AUDIO_CACHE.mkdir(exist_ok=True)
    return config.AUDIO_CACHE / f"{key}.wav"


def synthesize(text: str, lang_name: str) -> str:
    """Return a path to a wav file speaking `text`. Cached by content."""
    text = (text or "").strip()
    path = _cache_path(text, lang_name)
    if path.exists():
        return str(path)
    _load()
    if not text:
        _write_silence(path)
        return str(path)
    if _backend == "remote":
        try:
            return _synth_remote(text, lang_name, path)
        except Exception as e:
            print(f"[tts] remote synth failed ({e}); uncached beep")
            return _fail_beep()
    if _backend == "qwen3":  # pragma: no cover (needs CUDA)
        try:
            # Layers are hybrid (mixed source+target text), so let the model
            # auto-detect language per phrase rather than forcing one.
            wavs, sr = _qwen3.generate_custom_voice(
                text=text, language="Auto", speaker=config.QWEN3_SPEAKER,
            )
            _write_wav(path, wavs[0], sr)
            return str(path)
        except Exception as e:
            print(f"[tts] qwen3 synth failed ({e}); uncached beep")
            return _fail_beep()
    if _backend == "kokoro":
        lang_code, voice = _voice_for(lang_name)
        if voice:  # Kokoro has no voice for German/Russian/Korean yet
            try:
                samples, sr = _kokoro.create(text, voice=voice, speed=1.0, lang=lang_code)
                _write_wav(path, samples, sr)
                return str(path)
            except Exception as e:  # pragma: no cover
                print(f"[tts] kokoro synth failed ({e}); uncached beep")
                return _fail_beep()
    # No engine for this language (e.g. Kokoro lacks the voice): deterministic
    # fallback, safe to cache.
    _write_beep(path)
    return str(path)


def _fail_beep():
    """Beep written to a one-off file so a transient failure is NOT cached
    (the next request retries the real engine)."""
    import uuid
    config.AUDIO_CACHE.mkdir(exist_ok=True)
    p = config.AUDIO_CACHE / f"fail_{uuid.uuid4().hex[:8]}.wav"
    _write_beep(p)
    return str(p)


def _synth_remote(text, lang_name, path):
    """Fetch audio from a deployed instance's /api/tts and cache it locally.
    Retries once to absorb the deployed container's cold-start blip."""
    import json
    import time
    import urllib.request
    base = config.TTS_REMOTE_URL.rstrip("/")
    payload = json.dumps({"text": text, "lang": lang_name}).encode("utf-8")
    last = None
    for attempt in range(2):
        try:
            req = urllib.request.Request(
                base + "/api/tts", data=payload,
                headers={"Content-Type": "application/json"},
            )
            with urllib.request.urlopen(req, timeout=300) as r:  # cold start slow
                info = json.load(r)
            with urllib.request.urlopen(base + info["url"], timeout=120) as r:
                data = r.read()
            if len(data) < 25000:   # remote returned a beep -> treat as failure
                raise RuntimeError("remote returned fallback audio")
            path.write_bytes(data)
            return str(path)
        except Exception as e:
            last = e
            if attempt == 0:
                time.sleep(3)
    raise last


def _write_wav(path, samples, sr):
    import numpy as np
    data = np.asarray(samples, dtype="float32")
    if data.size:
        peak = float(np.max(np.abs(data))) or 1.0
        data = data / peak * 0.95
    pcm = (data * 32767).astype("<i2").tobytes()
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(sr))
        w.writeframes(pcm)


def _write_silence(path, sr=24000, secs=0.2):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\x00\x00" * int(sr * secs))


def _write_beep(path, sr=24000, secs=0.4, freq=440.0):
    import math
    frames = []
    for i in range(int(sr * secs)):
        v = int(0.3 * 32767 * math.sin(2 * math.pi * freq * i / sr))
        frames.append(struct.pack("<h", v))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"".join(frames))


if __name__ == "__main__":
    print("backend:", backend())
    p = synthesize("El gato se sentó en el tapete", "Spanish")
    print("wrote", p)
