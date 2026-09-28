# nexus-face: face detection for attendance selfies (CONTRACT batch 2, 29 Sep 2026).
#
# Internal only: it joins the nexus_internal docker network, publishes no port, and reads the
# uploads directory read-only. The app asks it "how many faces are in this selfie" from the
# attendance-face-check cron; nothing else talks to it.
#
#   docker build -t nexus-face:latest face/
#   bash face/run.sh
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
RUN pip install --no-cache-dir "opencv-python-headless>=4.10,<5" "numpy<3"

# YuNet (OpenCV Zoo, MIT). Baked in at build time so the container never needs the internet.
ADD https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx /models/yunet.onnx
RUN python -c "import os; assert os.path.getsize('/models/yunet.onnx') > 100000, 'model download failed (LFS pointer?)'"

COPY server.py /srv/server.py
RUN useradd --system --uid 10001 face && chmod 0444 /models/yunet.onnx
USER face
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=4)"
CMD ["python", "/srv/server.py"]
