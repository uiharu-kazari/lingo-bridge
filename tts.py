"""Text-to-speech for each translation layer — OpenBMB VoxCPM2.

Engines (set via TTS_ENGINE):
  * "voxcpm" — openbmb/VoxCPM2 via the `voxcpm` package (needs an NVIDIA GPU).
               The real engine on a GPU deployment (Modal / GPU Space). 30
               languages, no language tag needed (ideal for hybrid layers).
  * "remote" — proxy /api/tts to a deployed instance, so a GPU-less machine
               (local dev / CPU Space) uses the exact same audio.
A short beep is the only last-resort fallback if neither is available.

For a CONSISTENT narration voice across clips, set VOXCPM_REF_WAV to one fixed
reference clip (else VoxCPM2 may vary the voice between calls).

Audio is written to audio_cache/ and addressed by a content hash so repeated
requests are instant.
"""
from __future__ import annotations
import hashlib
import os
import struct
import wave

import config

# Default to the real model; use TTS_ENGINE=remote on a GPU-less machine.
ENGINE = os.environ.get("TTS_ENGINE", "voxcpm").lower()
VOXCPM_REPO = os.environ.get("VOXCPM_REPO", "openbmb/VoxCPM2")
VOXCPM_REF = os.environ.get("VOXCPM_REF_WAV", "")  # fixed reference for one voice

_voxcpm = None
_anchor = None   # one fixed reference clip -> consistent narrator voice
_backend = None  # "voxcpm" | "remote" | "beep"


def _load():
    global _voxcpm, _backend
    if _backend is not None:
        return
    if ENGINE == "remote":
        _backend = "remote"
        print(f"[tts] proxying TTS to {config.TTS_REMOTE_URL}")
        return
    if ENGINE == "voxcpm":
        try:                                    # pragma: no cover (needs CUDA)
            from voxcpm import VoxCPM
            _voxcpm = VoxCPM.from_pretrained(VOXCPM_REPO, load_denoiser=False)
            _backend = "voxcpm"
            print(f"[tts] loaded {VOXCPM_REPO}"
                  + (f" (ref voice {VOXCPM_REF})" if VOXCPM_REF else ""))
            return
        except Exception as e:                  # pragma: no cover
            print(f"[tts] VoxCPM2 unavailable ({e}); beep fallback "
                  "(set TTS_ENGINE=remote to use a deployed GPU instance)")
    _backend = "beep"


def backend() -> str:
    _load()
    return _backend


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
    if _backend == "voxcpm":  # pragma: no cover (needs CUDA)
        try:
            # No language tag — VoxCPM2 reads mixed-language text directly,
            # which suits the hybrid layers. Reuse one anchor clip so every
            # layer shares the same narrator voice.
            ref = VOXCPM_REF or _ensure_anchor()
            try:
                kwargs = {"text": text, "cfg_value": 2.0, "inference_timesteps": 10}
                if ref:
                    kwargs["reference_wav_path"] = ref
                wav = _voxcpm.generate(**kwargs)
            except TypeError:  # this voxcpm build lacks reference_wav_path
                wav = _voxcpm.generate(text=text, cfg_value=2.0, inference_timesteps=10)
            _write_wav(path, wav, _voxcpm.tts_model.sample_rate)
            return str(path)
        except Exception as e:
            print(f"[tts] voxcpm synth failed ({e}); uncached beep")
            return _fail_beep()
    _write_beep(path)
    return str(path)


def _ensure_anchor():
    """Generate one anchor clip once and reuse it as the reference voice, so all
    layers of an example sound like the same narrator. Returns a path or None."""
    global _anchor
    if _anchor:
        return _anchor
    try:
        config.AUDIO_CACHE.mkdir(exist_ok=True)
        p = config.AUDIO_CACHE / "_voxcpm_anchor.wav"
        if not p.exists():
            wav = _voxcpm.generate(
                text="This is the narrator voice for the demonstration.",
                cfg_value=2.0, inference_timesteps=10,
            )
            _write_wav(p, wav, _voxcpm.tts_model.sample_rate)
        _anchor = str(p)
        return _anchor
    except Exception as e:
        print(f"[tts] voxcpm anchor failed ({e}); default voice")
        return None


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
