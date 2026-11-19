import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from '@mediapipe/tasks-vision';

const WASM_URL = `${import.meta.env.BASE_URL}mediapipe/wasm`;
const MODEL_URL = `${import.meta.env.BASE_URL}mediapipe/face_landmarker.task`;
const INFERENCE_INTERVAL_MS = 45;
let verificationLandmarker: Promise<FaceLandmarker> | null = null;

async function createLandmarker(runningMode: 'IMAGE' | 'VIDEO', numFaces: number): Promise<FaceLandmarker> {
  const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
  const options = {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' as const },
    runningMode,
    numFaces,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  };
  try {
    return await FaceLandmarker.createFromOptions(fileset, options);
  } catch {
    return FaceLandmarker.createFromOptions(fileset, {
      ...options,
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    });
  }
}

export function loadFaceLandmarker(): Promise<FaceLandmarker> {
  if (!verificationLandmarker) {
    verificationLandmarker = createLandmarker('IMAGE', 1).catch(error => {
      verificationLandmarker = null;
      throw error;
    });
  }
  return verificationLandmarker;
}

type FaceScannerOptions = {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  status: HTMLElement;
  cameraIndicator: HTMLElement;
  startButton: HTMLButtonElement;
  stopButton: HTMLButtonElement;
  onFaceDetected?: () => void;
};

/** Webcam face mesh visualization. All inference runs locally in this browser. */
export class FaceScanner {
  private readonly context: CanvasRenderingContext2D;
  private stream: MediaStream | null = null;
  private landmarker: FaceLandmarker | null = null;
  private animationFrame = 0;
  private lastInferenceAt = 0;
  private lastVideoTime = -1;
  private scanning = false;
  private starting = false;
  private disposed = false;
  private startGeneration = 0;
  private faceWasDetected = false;
  private lastFaceCount = 0;
  private lastLandmarks: NormalizedLandmark[][] = [];
  private readonly options: FaceScannerOptions;

  constructor(options: FaceScannerOptions) {
    this.options = options;
    const context = options.canvas.getContext('2d');
    if (!context) throw new Error('Browser ini tidak mendukung Canvas 2D.');
    this.context = context;
    options.startButton.addEventListener('click', this.handleStart);
    options.stopButton.addEventListener('click', this.handleStop);
    this.setState('Kamera nonaktif. Tekan Mulai Scan untuk memulai.', false);
  }

  private readonly handleStart = (): void => {
    void this.start();
  };

  private readonly handleStop = (): void => {
    this.stopScanning();
  };

  private async start(): Promise<void> {
    if (this.scanning || this.starting || this.disposed) return;
    this.starting = true;
    const generation = ++this.startGeneration;
    this.options.startButton.disabled = true;
    this.options.stopButton.disabled = false;
    this.options.status.textContent = 'Memuat model deteksi wajah…';

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Akses kamera tidak tersedia. Gunakan browser modern melalui HTTPS atau localhost.');
      }

      if (!this.landmarker) {
        this.landmarker = await createLandmarker('VIDEO', 3);
        if (this.disposed || generation !== this.startGeneration) {
          this.landmarker.close();
          this.landmarker = null;
          return;
        }
      }

      if (this.disposed || generation !== this.startGeneration) {
        this.landmarker.close();
        this.landmarker = null;
        return;
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
      });
      if (this.disposed || generation !== this.startGeneration) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      this.stream = stream;
      this.options.video.srcObject = stream;
      await this.options.video.play();
      if (this.disposed || generation !== this.startGeneration) {
        this.releaseCamera();
        return;
      }

      this.lastInferenceAt = 0;
      this.lastVideoTime = -1;
      this.lastFaceCount = 0;
      this.scanning = true;
      this.options.cameraIndicator.classList.add('is-active');
      this.options.startButton.disabled = true;
      this.options.stopButton.disabled = false;
      this.setState('Kamera aktif · memindai wajah secara lokal', true);
      this.animationFrame = requestAnimationFrame(this.renderFrame);
    } catch (error) {
      this.releaseCamera();
      if (!this.disposed && generation === this.startGeneration) {
        this.options.startButton.disabled = false;
        this.options.stopButton.disabled = true;
        this.setState(this.getErrorMessage(error), false);
      }
    } finally {
      if (generation === this.startGeneration) this.starting = false;
    }
  }

  private readonly renderFrame = (now: number): void => {
    if (!this.scanning || this.disposed) return;
    this.animationFrame = requestAnimationFrame(this.renderFrame);
    const sweepNow = now;

    const { video, canvas } = this.options;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth || !video.videoHeight) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }

    this.context.clearRect(0, 0, canvas.width, canvas.height);

    if (now - this.lastInferenceAt >= INFERENCE_INTERVAL_MS && video.currentTime !== this.lastVideoTime) {
      this.lastInferenceAt = now;
      this.lastVideoTime = video.currentTime;
      try {
        const result = this.landmarker?.detectForVideo(video, now);
        const faces = result?.faceLandmarks ?? [];
        this.lastLandmarks = faces;
        this.lastFaceCount = faces.length;
        this.context.save();
        this.context.translate(canvas.width, 0);
        this.context.scale(-1, 1);
        this.drawFaces(faces, canvas.width, canvas.height, sweepNow);
        this.context.restore();
        this.setState(
          faces.length
            ? `${faces.length} wajah terdeteksi · mesh aktif · pemrosesan lokal`
            : 'Tidak ada wajah terdeteksi. Posisikan wajah di depan kamera.',
          true,
        );
      } catch (error) {
        console.error('[FaceScanner] Inference error:', error);
        this.setState('Pemindaian mengalami kendala. Tekan Hentikan lalu coba lagi.', true);
      }
    } else if (this.lastFaceCount > 0) {
      this.context.save();
      this.context.translate(canvas.width, 0);
      this.context.scale(-1, 1);
      this.drawFaces(this.lastLandmarks, canvas.width, canvas.height, sweepNow);
      this.context.restore();
    }

    if (this.lastFaceCount > 0 && !this.faceWasDetected) {
      this.faceWasDetected = true;
      this.options.onFaceDetected?.();
    } else if (this.lastFaceCount === 0) {
      this.faceWasDetected = false;
    }
  };

  private drawFaces(faces: NormalizedLandmark[][], width: number, height: number, now: number): void {
    for (const landmarks of faces) {
      if (landmarks.length === 0) continue;
      const xs = landmarks.map(point => point.x * width);
      const ys = landmarks.map(point => point.y * height);
      const left = Math.min(...xs);
      const right = Math.max(...xs);
      const top = Math.min(...ys);
      const bottom = Math.max(...ys);
      const faceWidth = right - left;
      const faceHeight = bottom - top;
      if (faceWidth <= 0 || faceHeight <= 0) continue;

      const insetX = faceWidth * 0.025;
      const insetY = faceHeight * 0.025;
      const x = left - insetX;
      const y = top - insetY;
      const boxWidth = faceWidth + insetX * 2;
      const boxHeight = faceHeight + insetY * 2;

      this.context.save();
      this.context.strokeStyle = 'rgba(59, 246, 222, 0.84)';
      this.context.lineWidth = Math.max(1.2, width / 500);
      this.context.shadowColor = '#20f6d1';
      this.context.shadowBlur = 12;
      this.context.strokeRect(x, y, boxWidth, boxHeight);

      const corner = Math.min(boxWidth, boxHeight) * 0.12;
      this.context.lineWidth = Math.max(2, width / 300);
      this.context.beginPath();
      const corners: [number, number, number, number][] = [
        [x, y, 1, 1], [x + boxWidth, y, -1, 1],
        [x, y + boxHeight, 1, -1], [x + boxWidth, y + boxHeight, -1, -1],
      ];
      for (const [cx, cy, dx, dy] of corners) {
        this.context.moveTo(cx, cy + dy * corner);
        this.context.lineTo(cx, cy);
        this.context.lineTo(cx + dx * corner, cy);
      }
      this.context.stroke();

      // Official MediaPipe connection sets, connected using original normalized landmarks.
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, width, height, 'rgba(28, 229, 209, 0.27)', 0.7);
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_CONTOURS, width, height, 'rgba(126, 255, 229, 0.95)', 1.55);
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, width, height, '#a4fff2', 1.8);
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, width, height, '#a4fff2', 1.8);
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, width, height, '#45e9dc', 1.5);
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, width, height, '#45e9dc', 1.5);
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, width, height, '#b0fff2', 1.7);
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, width, height, '#35ffe4', 2);
      this.drawConnections(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, width, height, '#35ffe4', 2);

      const sweep = (now % 2200) / 2200;
      const laserY = y + sweep * boxHeight;
      const gradient = this.context.createLinearGradient(x, laserY - 12, x, laserY + 12);
      gradient.addColorStop(0, 'rgba(0, 255, 228, 0)');
      gradient.addColorStop(0.5, 'rgba(0, 255, 228, 0.96)');
      gradient.addColorStop(1, 'rgba(0, 255, 228, 0)');
      this.context.shadowColor = '#00ffe1';
      this.context.shadowBlur = 18;
      this.context.fillStyle = gradient;
      this.context.fillRect(x, laserY - 12, boxWidth, 24);
      this.context.fillStyle = 'rgba(116, 255, 239, 0.92)';
      this.context.fillRect(x, laserY - 1, boxWidth, 2);
      this.context.restore();
    }
  }

  private drawConnections(
    landmarks: NormalizedLandmark[],
    connections: Array<{ start: number; end: number }>,
    width: number,
    height: number,
    color: string,
    lineWidth: number,
  ): void {
    this.context.beginPath();
    this.context.strokeStyle = color;
    this.context.lineWidth = lineWidth;
    for (const connection of connections) {
      const start = landmarks[connection.start];
      const end = landmarks[connection.end];
      if (!start || !end) continue;
      this.context.moveTo(start.x * width, start.y * height);
      this.context.lineTo(end.x * width, end.y * height);
    }
    this.context.stroke();

    if (connections === FaceLandmarker.FACE_LANDMARKS_CONTOURS) {
      this.context.fillStyle = '#bbfff7';
      for (let index = 0; index < landmarks.length; index += 2) {
        const point = landmarks[index];
        this.context.beginPath();
        this.context.arc(point.x * width, point.y * height, 1.15, 0, Math.PI * 2);
        this.context.fill();
      }
    }
  }

  stopScanning(): void {
    this.startGeneration++;
    this.starting = false;
    this.scanning = false;
    cancelAnimationFrame(this.animationFrame);
    this.releaseCamera();
    this.context.clearRect(0, 0, this.options.canvas.width, this.options.canvas.height);
    this.lastLandmarks = [];
    this.lastFaceCount = 0;
    this.faceWasDetected = false;
    this.options.cameraIndicator.classList.remove('is-active');
    this.options.startButton.disabled = this.disposed;
    this.options.stopButton.disabled = true;
    this.setState('Scanner dihentikan. Kamera ditutup dan stream dilepas.', false);
  }

  private releaseCamera(): void {
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.options.video.pause();
    this.options.video.srcObject = null;
  }

  private setState(message: string, active: boolean): void {
    this.options.status.textContent = message;
    this.options.cameraIndicator.setAttribute('aria-label', active ? 'Kamera aktif' : 'Kamera tidak aktif');
    this.options.cameraIndicator.title = active ? 'Kamera aktif' : 'Kamera tidak aktif';
    this.options.cameraIndicator.classList.toggle('is-active', active);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Izin kamera ditolak. Izinkan akses kamera pada pengaturan browser.';
    if (error instanceof DOMException && (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError')) return 'Webcam tidak ditemukan pada perangkat ini.';
    if (error instanceof DOMException && error.name === 'NotReadableError') return 'Kamera sedang dipakai aplikasi lain atau tidak dapat dibuka.';
    return error instanceof Error ? error.message : 'Scanner gagal dijalankan. Periksa kamera dan koneksi internet, lalu coba lagi.';
  }

  dispose(): void {
    if (this.disposed) return;
    this.stopScanning();
    this.disposed = true;
    this.releaseCamera();
    this.landmarker?.close();
    this.landmarker = null;
    this.options.startButton.removeEventListener('click', this.handleStart);
    this.options.stopButton.removeEventListener('click', this.handleStop);
    this.options.cameraIndicator.classList.remove('is-active');
    this.context.clearRect(0, 0, this.options.canvas.width, this.options.canvas.height);
    this.options.startButton.disabled = true;
    this.options.stopButton.disabled = true;
    this.setState('Scanner ditutup.', false);
  }
}
