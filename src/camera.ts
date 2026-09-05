export class CameraService {
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement;

  constructor(videoElementId: string) {
    this.videoEl = document.getElementById(videoElementId) as HTMLVideoElement;
  }

  async start(): Promise<void> {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      if (this.videoEl) {
        this.videoEl.srcObject = this.stream;
        this.videoEl.play();
      }
    } catch (err: any) {
      throw new Error('Gagal mengakses kamera: ' + err.message);
    }
  }

  stop(): void {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.videoEl) {
      this.videoEl.srcObject = null;
    }
  }

  captureBase64(targetWidth = 320): string {
    if (!this.videoEl) return '';
    const canvas = document.createElement('canvas');
    const scale = targetWidth / this.videoEl.videoWidth;
    canvas.width = targetWidth;
    canvas.height = this.videoEl.videoHeight * scale;

    const ctx = canvas.getContext('2d');
    if (ctx) {
      // Mirror the image since it's a selfie
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(this.videoEl, 0, 0, canvas.width, canvas.height);
    }
    // Compress heavily to ensure it fits in Google Sheets (50k chars limit)
    // 0.6 quality JPEG at 320px width is usually ~15-20KB Base64.
    return canvas.toDataURL('image/jpeg', 0.6);
  }
}
