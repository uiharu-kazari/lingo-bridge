FROM python:3.10-slim

# Non-root user (Hugging Face Spaces requirement)
RUN useradd -m -u 1000 user
WORKDIR /home/user/app

# Thin deps only — the Space proxies model calls to the Modal GPU backend,
# so there's nothing heavy to compile.
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

COPY --chown=user . .
RUN mkdir -p audio_cache && chown -R user:user audio_cache

USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PORT=7860 \
    LINGO_AUDIO_DIR=/home/user/app/audio_cache \
    LINGO_REMOTE_URL=https://uiharu-kazari--lingo-bridge-web.modal.run \
    TTS_ENGINE=remote \
    LINGO_TTS_REMOTE_URL=https://uiharu-kazari--lingo-bridge-web.modal.run

EXPOSE 7860
CMD ["python", "app.py"]
