interface Snowflake {
  x: number;
  y: number;
  radius: number;
  speedY: number;
  speedX: number;
  opacity: number;
  swaySpeed: number;
  swayAngle: number;
}

export class SnowOverlay {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private flakes: Snowflake[] = [];
  private isRunning: boolean = false;
  private enabled: boolean = true;
  private width: number = 0;
  private height: number = 0;
  private readonly flakeCount: number = 24;
  private timerId: number | null = null;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.id = "snow-overlay";
    this.canvas.style.position = "fixed";
    this.canvas.style.top = "0";
    this.canvas.style.left = "0";
    this.canvas.style.width = "100%";
    this.canvas.style.height = "100%";
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.zIndex = "5";
    this.canvas.style.opacity = "0.75";
    this.canvas.style.transform = "translateZ(0)";
    this.canvas.style.willChange = "transform";

    this.ctx = this.canvas.getContext("2d", { alpha: true, desynchronized: true });
    document.body.appendChild(this.canvas);

    this.handleResize();
    this.initFlakes();
    this.bindEvents();
    this.start();
  }

  private handleResize(): void {
    const dpr = window.devicePixelRatio || 1;
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = Math.floor(this.width * dpr);
    this.canvas.height = Math.floor(this.height * dpr);

    if (this.ctx) {
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
  }

  private initFlakes(): void {
    this.flakes = [];
    for (let i = 0; i < this.flakeCount; i++) {
      this.flakes.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        radius: 1.0 + Math.random() * 2.2,
        speedY: 0.4 + Math.random() * 0.9,
        speedX: -0.2 + Math.random() * 0.4,
        opacity: 0.2 + Math.random() * 0.65,
        swaySpeed: 0.01 + Math.random() * 0.02,
        swayAngle: Math.random() * Math.PI * 2,
      });
    }
  }

  private bindEvents(): void {
    window.addEventListener("resize", () => {
      this.handleResize();
    });

    // Zero-overhead backgrounding: pause when window is hidden or blurred
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.stop();
      else this.start();
    });
    window.addEventListener("blur", () => this.stop());
    window.addEventListener("focus", () => this.start());
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.canvas.style.display = enabled ? "block" : "none";
    if (enabled) this.start();
    else this.stop();
  }

  public start(): void {
    if (!this.enabled || this.isRunning) return;
    this.isRunning = true;
    this.tick();
  }

  public stop(): void {
    this.isRunning = false;
    if (this.timerId !== null) {
      window.clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.ctx) {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }

  private tick = (): void => {
    if (!this.isRunning) return;
    this.render();
    // 20 FPS timer (50ms interval) completely eliminates rAF loop on 144Hz/240Hz monitors
    this.timerId = window.setTimeout(this.tick, 50);
  };

  private render(): void {
    if (!this.ctx) return;

    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = "rgba(224, 242, 254, 0.42)";
    this.ctx.beginPath();

    const len = this.flakes.length;
    for (let i = 0; i < len; i++) {
      const flake = this.flakes[i];
      if (!flake) continue;

      flake.swayAngle += flake.swaySpeed;
      flake.y += flake.speedY;
      flake.x += flake.speedX;

      // Wrap around boundaries
      if (flake.y > this.height) {
        flake.y = -5;
        flake.x = Math.random() * this.width;
      }
      if (flake.x > this.width + 5) {
        flake.x = -5;
      } else if (flake.x < -5) {
        flake.x = this.width + 5;
      }

      this.ctx.moveTo(flake.x + flake.radius, flake.y);
      this.ctx.arc(flake.x, flake.y, flake.radius, 0, 6.2831853);
    }
    this.ctx.fill();
  }
}
