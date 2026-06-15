import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mixRGB } from "/static/app.js?v=18";

const col = (mix) => {
  const [r, g, b] = mixRGB(mix);
  return new THREE.Color(r / 255, g / 255, b / 255);
};

const UNIT_COLORS = [
  new THREE.Color(0xa855f7), // Purple
  new THREE.Color(0x3b82f6), // Blue
  new THREE.Color(0x1fe0d0), // Cyan/Teal
  new THREE.Color(0xf59e0b), // Gold
  new THREE.Color(0x22c55e), // Green
  new THREE.Color(0xf43f5e), // Pink
  new THREE.Color(0x6366f1), // Indigo
  new THREE.Color(0xf97316), // Orange
];

// world layout constants (Z is now vertical, Y is layer depth, X is horizontal width)
const LAYER_GAP = 7.0;     // spacing between layers along Y (depth)
const BLOCK_H = 2.0;       // vertical height (along Z)
const BLOCK_T = 0.55;      // thickness (along Y)
const WORLD_W = 26;        // total row width (along X)
const SOUNDBAR_X = -15.0;  // X position of sound bar to the right of the row
const SOUNDBAR_W = 2.2;    // sound bar base plate width

export class CardsView {
  constructor(container, hooks) {
    this.c = container;
    this.hooks = hooks;
    this.data = null;
    this.blocks = [];   // {mesh, label, unit, layer, baseOp, hoverOffset, targetHoverOffset, playOffset, playVelocity, isDivider}
    this.ribbons = [];  // {mesh, a, b, lk, baseOp}
    
    // Morph states: 0 = 2D Parallel Sets, 1 = 3D Card Stack
    this.perspective = 1.0;
    this.targetPerspective = 1.0;
    this.transitionSpeed = 0.08;
    
    this.camRadius = null;
    this.targetCamRadius = null;
    this.theta3D = null;
    this.currentTheta = 0;
    this.targetTheta = 0;
    this.targetPan = new THREE.Vector3(0, 0, 0);
    this.panOffset = new THREE.Vector3(0, 0, 0); // horizontal view pan (x,y)
    this.panVel = new THREE.Vector3(0, 0, 0);    // pan momentum (units/frame)
    this.activeLayerIdx = -1;
    this._hoveredBlock = null;
    this.controlsEnabled = true;
    
    this._init();
  }

  _init() {
    const w = this.c.clientWidth || 800, h = this.c.clientHeight || 600;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    
    // Enable soft shadow mapping
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    this.c.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x030408); // dark background
    this.scene.fog = new THREE.FogExp2(0x030408, 0.0055);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.5;
    this.controls.minDistance = 4.0;
    this.controls.maxDistance = 100.0;
    this.controls.enableZoom = false; // Disable default zoom scroll to use custom combined scroll

    // Combined scroll handler: mouse wheel adjusts both perspective morph and camera closeness
    this.renderer.domElement.addEventListener("wheel", (e) => {
      if (!this.controlsEnabled) return;
      e.preventDefault();
      const delta = -e.deltaY * 0.0012; // zoom scroll speed factor
      
      // Update target perspective factor
      this.targetPerspective = Math.max(0, Math.min(1, this.targetPerspective + delta));
      
      // Scale radius/closeness target in sync with perspective factor
      const { minRadius, maxRadius } = this._getRadii();
      
      this.targetCamRadius = Math.max(minRadius, Math.min(maxRadius, (this.targetCamRadius || this.camRadius) - delta * (maxRadius - minRadius) * 0.85));
      this._updateMorph();
    }, { passive: false });

    // Bright studio ambient + soft sky/ground hemisphere fill
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.15));
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd7dcea, 0.9));

    // Directional Key Light with shadow casting (Z is now vertical high-axis)
    const k = new THREE.DirectionalLight(0xffffff, 1.7);
    k.position.set(12, 18, 35);
    k.castShadow = true;
    k.shadow.mapSize.width = 2048;
    k.shadow.mapSize.height = 2048;
    k.shadow.camera.near = 0.5;
    k.shadow.camera.far = 120;
    const d = 40;
    k.shadow.camera.left = -d;
    k.shadow.camera.right = d;
    k.shadow.camera.top = d;
    k.shadow.camera.bottom = -d;
    k.shadow.bias = -0.0003;
    this.scene.add(k);

    // Cyan and Purple accents saved as properties for animated shimmer reflections (Z is vertical)
    this.p1 = new THREE.PointLight(0xa855f7, 70, 100);
    this.p1.position.set(-22, -18, 10);
    this.scene.add(this.p1);

    this.p2 = new THREE.PointLight(0x1fe0d0, 70, 100);
    this.p2.position.set(22, 18, 10);
    this.scene.add(this.p2);

    this._initTextures();
    this._ground();

    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this._hovered = null;
    this.renderer.domElement.addEventListener("pointermove", (e) => this._onMove(e));
    this.renderer.domElement.addEventListener("pointerdown", (e) => this._onClick(e));

    window.addEventListener("resize", () => this._resize());
    this._animate();
  }

  _initTextures() {
    // 1. High-fidelity procedural walnut wood texture (pixel loop)
    const woodCanvas = document.createElement("canvas");
    woodCanvas.width = 512;
    woodCanvas.height = 512;
    const wCtx = woodCanvas.getContext("2d");
    const imgData = wCtx.createImageData(512, 512);
    const data = imgData.data;
    
    // Distorted coordinate generation for realistic wood grain waves
    for (let y = 0; y < 512; y++) {
      for (let x = 0; x < 512; x++) {
        // wood plank runs vertically (grain lines parallel to Y)
        const scaleX = x * 0.055;
        const scaleY = y * 0.009;
        
        // Add coordinate distortion (wave frequency and amplitude)
        const distortion = Math.sin(scaleY * 2.8) * 3.5 + Math.cos(scaleX * 0.45) * 1.5;
        const ringValue = Math.sin((scaleX + distortion) * 1.1) * 0.5 + 0.5;
        
        // Add fine fibrous noise
        const fiberValue = (Math.sin(x * 1.6) * Math.cos(y * 0.22)) * 0.12;
        const val = Math.max(0, Math.min(1, ringValue + fiberValue));
        
        // Map val to a rich, warm dark walnut color gradient
        // Dark ring lines: #20110a (rgb 32, 17, 10)
        // Mid grain: #3a2014 (rgb 58, 32, 20)
        // Golden grain: #4c2c1b (rgb 76, 44, 27)
        // Rich, warm dark walnut wood tones
        let r, g, b;
        if (val < 0.5) {
          const t = val * 2;
          r = 32 + t * (58 - 32);
          g = 17 + t * (32 - 17);
          b = 10 + t * (20 - 10);
        } else {
          const t = (val - 0.5) * 2;
          r = 58 + t * (76 - 58);
          g = 32 + t * (44 - 32);
          b = 20 + t * (27 - 20);
        }
        
        // Apply slight noise/roughness
        const noise = (Math.random() - 0.5) * 4;
        r = Math.max(0, Math.min(255, Math.round(r + noise)));
        g = Math.max(0, Math.min(255, Math.round(g + noise)));
        b = Math.max(0, Math.min(255, Math.round(b + noise)));
        
        const pixelIdx = (x + y * 512) * 4;
        data[pixelIdx] = r;
        data[pixelIdx + 1] = g;
        data[pixelIdx + 2] = b;
        data[pixelIdx + 3] = 255;
      }
    }
    wCtx.putImageData(imgData, 0, 0);
    
    // Draw fine vertical wood pores/scratches along the Y axis
    wCtx.strokeStyle = "rgba(76, 44, 27, 0.22)";
    wCtx.lineWidth = 1.0;
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const len = 35 + Math.random() * 140;
      wCtx.beginPath();
      wCtx.moveTo(x, y);
      wCtx.lineTo(x, y + len);
      wCtx.stroke();
    }
    
    // Fine vertical light grain reflections
    wCtx.strokeStyle = "rgba(255, 255, 255, 0.015)";
    wCtx.lineWidth = 0.8;
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const len = 20 + Math.random() * 80;
      wCtx.beginPath();
      wCtx.moveTo(x, y);
      wCtx.lineTo(x, y + len);
      wCtx.stroke();
    }
    
    this.woodTex = new THREE.CanvasTexture(woodCanvas);
    this.woodTex.wrapS = THREE.RepeatWrapping;
    this.woodTex.wrapT = THREE.RepeatWrapping;
    this.woodTex.repeat.set(4, 4);

    // 2. Procedural Card Brushed Metal Scratch Map
    const metalCanvas = document.createElement("canvas");
    metalCanvas.width = 256;
    metalCanvas.height = 256;
    const mCtx = metalCanvas.getContext("2d");
    
    mCtx.fillStyle = "#808080";
    mCtx.fillRect(0, 0, 256, 256);
    
    // Fine bright steel scratches
    mCtx.strokeStyle = "rgba(255, 255, 255, 0.16)";
    mCtx.lineWidth = 1.0;
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const len = 25 + Math.random() * 80;
      mCtx.beginPath();
      mCtx.moveTo(x, y);
      mCtx.lineTo(x + len, y);
      mCtx.stroke();
    }
    
    // Fine dark steel scratches
    mCtx.strokeStyle = "rgba(0, 0, 0, 0.08)";
    for (let i = 0; i < 250; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const len = 15 + Math.random() * 55;
      mCtx.beginPath();
      mCtx.moveTo(x, y);
      mCtx.lineTo(x + len, y);
      mCtx.stroke();
    }
    
    this.cardMetalTex = new THREE.CanvasTexture(metalCanvas);
    this.cardMetalTex.wrapS = THREE.RepeatWrapping;
    this.cardMetalTex.wrapT = THREE.RepeatWrapping;
    this.cardMetalTex.repeat.set(2, 2);
  }

  _ground() {
    // 1. Sleek polished wooden walnut desk sitting flat in the X-Y plane (Z is up)
    const deskGeo = new THREE.PlaneGeometry(180, 180);
    const deskMat = new THREE.MeshStandardMaterial({
      map: this.woodTex,
      bumpMap: this.woodTex,
      bumpScale: 0.005,
      roughness: 0.46,
      metalness: 0.08,
      side: THREE.DoubleSide
    });
    const desk = new THREE.Mesh(deskGeo, deskMat);
    desk.position.z = 0; // sits flat on X-Y plane
    desk.receiveShadow = true;
    this.scene.add(desk);

    // 2. Faded structure grid overlay rotated flat to X-Y
    const grid = new THREE.GridHelper(180, 45, 0x7d93c4, 0xb9a98c);
    grid.rotation.x = Math.PI / 2; // orient to X-Y plane
    grid.position.z = 0.001;
    grid.material.opacity = 0.06;
    grid.material.transparent = true;
    this.scene.add(grid);

    // 3. Ambient radial glow texture
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(256, 256, 10, 256, 256, 256);
    grd.addColorStop(0, "rgba(255,255,255,0.12)");
    grd.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grd; g.fillRect(0, 0, 512, 512);
    const tex = new THREE.CanvasTexture(c);
    const glowPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(150, 150),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    );
    glowPlane.position.z = 0.002;
    this.scene.add(glowPlane);
  }

  _clear() {
    [...this.blocks, ...this.ribbons].forEach((o) => {
      o.mesh.geometry.dispose();
      if (o.mesh.material.map) o.mesh.material.map.dispose();
      o.mesh.material.dispose();
      this.scene.remove(o.mesh);
    });
    this.blocks = []; this.ribbons = [];
  }

  render(data) {
    this.data = data;
    this._clear();
    const layers = data.layers;
    const n = layers.length;
    const byId = {};

    // Fine lane dividers on the wooden desk (polished brass dividers aligned horizontally in X-Y)
    for (let i = 0; i < n - 1; i++) {
      const dividerY = (i - (n - 2) / 2) * LAYER_GAP - LAYER_GAP / 2;
      const dividerGeo = new THREE.BoxGeometry(WORLD_W * 1.25, 0.04, 0.02);
      const dividerMat = new THREE.MeshStandardMaterial({
        color: 0xb58e4c,
        metalness: 1.0,
        roughness: 0.24
      });
      const divMesh = new THREE.Mesh(dividerGeo, dividerMat);
      divMesh.position.set(0, dividerY, 0.005);
      divMesh.receiveShadow = true;
      this.scene.add(divMesh);
      this.blocks.push({ mesh: divMesh, isDivider: true });
    }

    layers.forEach((layer, li) => {
      const y = (li - (n - 1) / 2) * LAYER_GAP;        // layer depth along Y

      // Realistic 3D speaker beside each row — CLICK it to play that layer.
      const layerMix = n > 1 ? li / (n - 1) : 0.0;
      const layerColor = col(layerMix);
      const frontY = (BLOCK_T * 0.9) / 2; // local +Y face (toward viewer)
      const noRay = (m) => { m.raycast = () => {}; return m; };

      // Cabinet (dark, matte — reads as a speaker enclosure on the light desk)
      const sbGeo = new THREE.BoxGeometry(SOUNDBAR_W, BLOCK_T * 0.9, BLOCK_H);
      const sbMat = new THREE.MeshStandardMaterial({ color: 0x232838, roughness: 0.55, metalness: 0.5 });
      const sbMesh = new THREE.Mesh(sbGeo, sbMat);
      sbMesh.castShadow = true;
      sbMesh.receiveShadow = true;
      sbMesh.position.set(SOUNDBAR_X, y, BLOCK_H / 2);
      sbMesh.add(new THREE.LineSegments(
        new THREE.EdgesGeometry(sbGeo),
        new THREE.LineBasicMaterial({ color: 0x3a4256, transparent: true, opacity: 0.5 })
      ));

      const darkMat = new THREE.MeshStandardMaterial({ color: 0x0c0e16, roughness: 0.45, metalness: 0.7 });
      const coneMat = new THREE.MeshStandardMaterial({ color: layerColor, emissive: layerColor, emissiveIntensity: 0.15, metalness: 0.45, roughness: 0.4 });
      const domeMat = new THREE.MeshStandardMaterial({ color: layerColor, emissive: layerColor, emissiveIntensity: 0.2, metalness: 0.55, roughness: 0.3 });

      // Woofer: rubber surround (torus) + convex cone + dust cap (lower)
      const surround = noRay(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.08, 16, 32), darkMat));
      surround.rotation.x = Math.PI / 2; surround.position.set(0, frontY + 0.02, -0.45);
      sbMesh.add(surround);
      const woofer = noRay(new THREE.Mesh(new THREE.ConeGeometry(0.46, 0.18, 32), coneMat));
      woofer.position.set(0, frontY + 0.10, -0.45); // apex toward +Y (viewer)
      sbMesh.add(woofer);
      const cap = noRay(new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 16), darkMat));
      cap.position.set(0, frontY + 0.18, -0.45);
      sbMesh.add(cap);

      // Tweeter (upper): small surround + dome
      const twRing = noRay(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.05, 12, 24), darkMat));
      twRing.rotation.x = Math.PI / 2; twRing.position.set(0, frontY + 0.02, 0.55);
      sbMesh.add(twRing);
      const tweeter = noRay(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 20), domeMat));
      tweeter.position.set(0, frontY + 0.05, 0.55);
      sbMesh.add(tweeter);

      // Status LED (glows while playing)
      const led = noRay(new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 12),
        new THREE.MeshStandardMaterial({ color: layerColor, emissive: layerColor, emissiveIntensity: 0.4 })
      ));
      led.position.set(0.72, frontY + 0.03, 0.92);
      sbMesh.add(led);

      this.scene.add(sbMesh);
      this.blocks.push({
        mesh: sbMesh, driver: woofer, tweeter, led,
        layer: li, isSoundBar: true, isDivider: false,
        hoverOffset: 0.0, targetHoverOffset: 0.0, playOffset: 0.0, playVelocity: 0.0,
        baseOp: 1.0,
      });

      const chunks = [...layer.chunks].sort((a, b) => a.pos - b.pos);
      const lens = chunks.map((c) => Math.max(2.2, c.text.length));
      const tot = lens.reduce((a, b) => a + b, 0);
      const gap = 0.5;
      const totGap = gap * (chunks.length - 1);
      const scale = (WORLD_W - totGap) / tot;
      // Lay out from +X toward -X so phrase pos 0 renders on screen-LEFT.
      // (The camera sits at +Y looking -Y, which maps world -X to screen-right,
      // so a naive -X..+X layout would read the row backwards.)
      let x = WORLD_W / 2;

      chunks.forEach((ch, i) => {
        const w = Math.max(2.0, lens[i] * scale);
        const cx = x - w / 2;
        const color = UNIT_COLORS[ch.unit % UNIT_COLORS.length];
        
        // Solid Machined Brushed Anodized Metal Block
        const mat = new THREE.MeshStandardMaterial({
          color, 
          transparent: true, 
          opacity: 1.0,
          metalness: 1.0, 
          roughness: 0.26,
          bumpMap: this.cardMetalTex,
          bumpScale: 0.003,
          emissive: color.clone().multiplyScalar(0.08),
        });
        
        // Box width = X, thickness = Y, height = Z
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, BLOCK_T, BLOCK_H), mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(cx, y, BLOCK_H / 2);
        
        // Shiny glowing metallic edges
        const edges = new THREE.LineSegments(
          new THREE.EdgesGeometry(mesh.geometry),
          new THREE.LineBasicMaterial({ 
            color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.45), 
            transparent: true, 
            opacity: 0.8 
          })
        );
        mesh.add(edges);
        
        // Create label and add it flat against the local front face (local Y face)
        const label = this._label(ch.text, w, color);
        label.position.set(0, BLOCK_T / 2 + 0.02, 0);
        label.rotation.set(-Math.PI / 2, 0, Math.PI);
        mesh.add(label);
        
        this.scene.add(mesh);
        
        const rec = { 
          mesh, 
          label, 
          unit: ch.unit, 
          layer: li, 
          baseOp: 1.0,
          cx,
          y,
          isDivider: false,
          
          // Physical spring offsets
          hoverOffset: 0.0,
          targetHoverOffset: 0.0,
          playOffset: 0.0,
          playVelocity: 0.0
        };
        this.blocks.push(rec);
        byId[ch.id] = rec;
        x -= w + gap;
      });
    });

    // Ribbons between adjacent layers
    data.links.forEach((lk) => {
      const a = byId[lk.from], b = byId[lk.to];
      if (!a || !b) return;
      this.ribbons.push(this._ribbon(a, b, lk));
    });

    this._frameCamera(n);
    this._updateMorph();
  }

  _label(text, w, color) {
    const PX = 256, ratio = Math.max(1, Math.min(12, w / BLOCK_H));
    const cw = Math.round(PX * ratio), ch = PX;
    const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cw, ch);
    
    let fs = 76;
    g.font = `600 ${fs}px 'Space Grotesk', system-ui, sans-serif`;
    const textWidth = g.measureText(text).width;
    const maxTextWidth = cw * 0.88;
    if (textWidth > maxTextWidth) {
      fs = Math.floor(fs * (maxTextWidth / textWidth));
      g.font = `600 ${fs}px 'Space Grotesk', system-ui, sans-serif`;
    }
    
    g.fillStyle = "rgba(255,255,255,0.96)";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 8;
    g.fillText(text, cw / 2, ch / 2);
    
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, BLOCK_H * 0.92), mat);
    plane.renderOrder = 1;
    return plane;
  }

  // Ribbon as a thin metallic FOIL slab: 4 vertices per sample (top/bottom x
  // left/right) -> top face, bottom face, and two edges give it real thickness.
  _ribbon(a, b, lk) {
    const N = 40;
    const V = (N + 1) * 4;
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array(V * 3);
    const cols = new Float32Array(V * 3);

    const colorA = a.mesh.material.color;
    const colorB = b.mesh.material.color;
    for (let i = 0; i <= N; i++) {
      const cc = colorA.clone().lerp(colorB, i / N);
      for (let c = 0; c < 4; c++) {
        const o = (i * 4 + c) * 3;
        cols[o] = cc.r; cols[o + 1] = cc.g; cols[o + 2] = cc.b;
      }
    }

    const idx = [];
    for (let i = 0; i < N; i++) {
      const a0 = i * 4, b0 = (i + 1) * 4; // corners: 0 TL,1 TR,2 BL,3 BR
      idx.push(a0 + 0, a0 + 1, b0 + 0, a0 + 1, b0 + 1, b0 + 0); // top
      idx.push(a0 + 2, b0 + 2, a0 + 3, a0 + 3, b0 + 2, b0 + 3); // bottom
      idx.push(a0 + 0, b0 + 0, a0 + 2, a0 + 2, b0 + 0, b0 + 2); // left edge
      idx.push(a0 + 1, a0 + 3, b0 + 1, a0 + 3, b0 + 3, b0 + 1); // right edge
    }

    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    geo.setIndex(idx);

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      transparent: true,
      opacity: lk.kind === "keep" ? 0.5 : 0.8,
      side: THREE.DoubleSide,
      depthWrite: false,
      metalness: 0.9,
      roughness: 0.3,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.baseOp = mat.opacity;
    this.scene.add(mesh);

    return { mesh, a, b, lk, baseOp: mat.opacity };
  }

  _updateRibbonGeometry(rb, t) {
    const up = new THREE.Vector3(0, 0, 1); // vertical axis is Z
    const p0 = new THREE.Vector3();
    const p3 = new THREE.Vector3();

    // Precise endpoints: previous-layer card BOTTOM (local -Z) to next-layer
    // card TOP (local +Z). localToWorld tracks the card's live transform.
    rb.a.mesh.localToWorld(p0.set(0, 0, -BLOCK_H / 2));
    rb.b.mesh.localToWorld(p3.set(0, 0, BLOCK_H / 2));

    const dy = p3.y - p0.y;
    const dz = p3.z - p0.z;
    const lift = 0.6 * t; // gentle elevated arc in 3D, flat in 2D
    const c1 = p0.clone().add(new THREE.Vector3(0, dy * 0.25, dz * 0.25 + lift));
    const c2 = p3.clone().add(new THREE.Vector3(0, -dy * 0.25, -dz * 0.25 + lift));

    const curve = new THREE.CubicBezierCurve3(p0, c1, c2, p3);
    const N = 40;
    const hw = 1.25;     // foil half-width
    const halfT = 0.08;  // foil half-thickness
    const pts = curve.getPoints(N);

    const geo = rb.mesh.geometry;
    const posAttr = geo.getAttribute("position");
    const verts = posAttr.array;
    const side = new THREE.Vector3();
    const nrm = new THREE.Vector3();

    let v = 0;
    for (let i = 0; i <= N; i++) {
      const pt = pts[i];
      const tan = curve.getTangent(i / N);
      side.crossVectors(up, tan).normalize().multiplyScalar(hw);
      nrm.crossVectors(tan, side).normalize().multiplyScalar(halfT);
      // corners — 0: +side +nrm
      verts[v++] = pt.x + side.x + nrm.x; verts[v++] = pt.y + side.y + nrm.y; verts[v++] = pt.z + side.z + nrm.z;
      // 1: -side +nrm
      verts[v++] = pt.x - side.x + nrm.x; verts[v++] = pt.y - side.y + nrm.y; verts[v++] = pt.z - side.z + nrm.z;
      // 2: +side -nrm
      verts[v++] = pt.x + side.x - nrm.x; verts[v++] = pt.y + side.y - nrm.y; verts[v++] = pt.z + side.z - nrm.z;
      // 3: -side -nrm
      verts[v++] = pt.x - side.x - nrm.x; verts[v++] = pt.y - side.y - nrm.y; verts[v++] = pt.z - side.z - nrm.z;
    }

    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
  }

  _frameCamera(n) {
    const depth = (n - 1) * LAYER_GAP;
    // Radial distance and angled framing (theta3D = 60 degrees from vertical Z)
    this.camRadius = Math.max(15, depth * 0.46 + 11.0);
    this.targetCamRadius = this.camRadius;
    this.theta3D = 1.05;
    this.currentTheta = 0; // Reset rotation on new load
    this.targetTheta = 0;
    this.panOffset.set(0, 0, 0); // re-center pan on new load
    this.panVel.set(0, 0, 0);

    this.targetPan.set(0, 0, 1.0 * this.perspective);
    this.controls.target.copy(this.targetPan);

    if (this.hooks.onZoomChange) {
      this.hooks.onZoomChange(this.getZoom());
    }
  }

  _updateCameraPerspective(t, forceUseCurrentTheta = false) {
    if (!this.camRadius) return;
    
    // Get target-relative camera position
    const dx = this.camera.position.x - this.controls.target.x;
    const dy = this.camera.position.y - this.controls.target.y;
    
    // Recalculate azimuthal angle (rotation around Z axis)
    // Only update this.currentTheta if we are not at the overhead singularity (flat 2D view)
    let azimuth = this.currentTheta || 0;
    if (!forceUseCurrentTheta && t >= 0.01 && Math.sqrt(dx * dx + dy * dy) > 0.1) {
      azimuth = Math.atan2(dx, dy);
      this.currentTheta = azimuth;
      this.targetTheta = azimuth;
      this.targetPan.copy(this.controls.target);
      this.targetCamRadius = this.camera.position.distanceTo(this.controls.target);
    }
    
    if (t < 0.01) {
      // 2D Zenith View: lock controls, set camera overhead, up vector is rotated Y-back
      this.controls.enabled = false;
      this.camera.position.set(this.panOffset.x, this.panOffset.y, this.camRadius);
      this.camera.up.set(Math.sin(azimuth), -Math.cos(azimuth), 0).normalize();
      this.controls.target.set(this.panOffset.x, this.panOffset.y, 0);
    } else {
      // 3D Perspective View: enable controls, up vector is strictly Z-up
      this.controls.enabled = true;
      
      const phi = t * this.theta3D;
      const x = this.camRadius * Math.sin(phi) * Math.sin(azimuth);
      const y = this.camRadius * Math.sin(phi) * Math.cos(azimuth);
      const z = this.camRadius * Math.cos(phi);

      const tx = this.panOffset.x, ty = this.panOffset.y, tz = 1.0 * t;
      this.camera.position.set(tx + x, ty + y, tz + z);
      this.camera.up.set(0, 0, 1);
      this.controls.target.set(tx, ty, tz);
      
      // Update OrbitControls limits
      this.controls.enableRotate = true;
      this.controls.maxPolarAngle = Math.PI * 0.5;
      this.controls.minPolarAngle = 0.01;
    }
  }

  _updateCardsPerspective(t) {
    this.blocks.forEach((b) => {
      if (b.isDivider) return;
      
      // Rotate cards around X: flat (PI/2) at 2D overview, to upright (0) at 3D perspective
      b.mesh.rotation.x = (1 - t) * (Math.PI / 2);
      
      // Height position in vertical Z: flat (BLOCK_T / 2 + 0.01) to upright (BLOCK_H / 2) with active spring offsets added
      const baseZ = (1 - t) * (BLOCK_T / 2 + 0.01) + t * (BLOCK_H / 2);
      b.mesh.position.z = baseZ + b.hoverOffset + b.playOffset;
    });
  }

  _updateMorph(forceUseCurrentTheta = false) {
    this._updateCameraPerspective(this.perspective, forceUseCurrentTheta);
    this._updateCardsPerspective(this.perspective);
    this.ribbons.forEach((rb) => this._updateRibbonGeometry(rb, this.perspective));
  }

  transitionTo(target) {
    this.targetPerspective = Math.max(0, Math.min(1, target));
  }

  setPerspective(val, triggerCallback = true) {
    this.perspective = Math.max(0, Math.min(1, val));
    this.targetPerspective = this.perspective;
    this._updateMorph();
    if (triggerCallback && this.hooks.onPerspectiveChange) {
      this.hooks.onPerspectiveChange(this.perspective);
    }
  }

  _getRadii() {
    const depth = (this.data ? this.data.layers.length : 4) * LAYER_GAP;
    const minRadius = Math.max(4.0, depth * 0.15 + 2.0);
    const maxRadius = Math.max(28.0, depth * 0.54 + 13.0);
    return { minRadius, maxRadius };
  }

  getZoom() {
    if (this.camRadius === null) return 0.5;
    const { minRadius, maxRadius } = this._getRadii();
    const val = (maxRadius - this.camRadius) / (maxRadius - minRadius);
    return Math.max(0, Math.min(1, val));
  }

  setZoom(t) {
    const { minRadius, maxRadius } = this._getRadii();
    const radius = maxRadius - t * (maxRadius - minRadius);
    this.targetCamRadius = Math.max(minRadius, Math.min(maxRadius, radius));
  }

  zoomIn() {
    this.zoomStep(0.08);
  }

  zoomOut() {
    this.zoomStep(-0.08);
  }

  zoomStep(delta) {
    const { minRadius, maxRadius } = this._getRadii();
    const step = delta * (maxRadius - minRadius);
    this.targetCamRadius = Math.max(minRadius, Math.min(maxRadius, (this.targetCamRadius || this.camRadius) - step));
  }

  setControlsEnabled(enabled) {
    this.controlsEnabled = enabled;
    if (this.controls) {
      this.controls.enabled = enabled && (this.perspective >= 0.01);
    }
  }

  rotateLeft() {
    this.targetTheta = (this.targetTheta || 0) + 0.3;
  }

  rotateRight() {
    this.targetTheta = (this.targetTheta || 0) - 0.3;
  }

  moveForward() {
    this._addPanImpulse(0.25);
  }

  moveBackward() {
    this._addPanImpulse(-0.25);
  }

  // Add velocity along the horizontal view direction. Clicks accumulate; the
  // friction in _animate eases motion out smoothly (no abrupt stop). Capped so
  // rapid clicking reaches a steady glide speed rather than flinging away.
  _addPanImpulse(step) {
    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    dir.z = 0; // horizontal plane only
    if (dir.lengthSq() < 1e-4) {
      dir.set(0, 1, 0);
    } else {
      dir.normalize();
    }
    this.panVel.addScaledVector(dir, step);
    const MAX = 0.5; // units/frame steady-state speed cap
    if (this.panVel.length() > MAX) this.panVel.setLength(MAX);
  }

  // ---- interaction
  _onMove(e) {
    if (!this.controlsEnabled) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    
    // Filter out dividers for raycasting
    const activeBlocks = this.blocks.filter(b => !b.isDivider);
    const hit = this.raycaster.intersectObjects(activeBlocks.map((b) => b.mesh), false)[0];
    const hitBlock = hit ? activeBlocks.find((b) => b.mesh === hit.object) : null;
    
    let cursor = "default";
    if (hitBlock) {
      if (hitBlock.isSoundBar) {
        cursor = "pointer";
      } else if (hitBlock.unit != null) {
        cursor = "pointer";
      }
    }
    
    const unit = (hitBlock && !hitBlock.isSoundBar) ? hitBlock.unit : null;
    
    if (unit !== this._hovered || hitBlock !== this._hoveredBlock) {
      this._hovered = unit ?? null;
      this._hoveredBlock = hitBlock;
      this.hooks.onHover(this._hovered);
      
      // Word-chain levitation — phrase blocks only; speakers never lift on hover.
      // The directly-hovered block does NOT lift (avoids cursor-leave → jitter
      // feedback loop). It gets an emissive glow instead. Chain siblings on
      // other layers still levitate to show the trace.
      this.blocks.forEach((b) => {
        if (b.isDivider || b.isSoundBar) { b.targetHoverOffset = 0.0; return; }
        if (hitBlock && b === hitBlock) {
          // Stay in place — highlight via emissive boost (applied below)
          b.targetHoverOffset = 0.0;
        } else if (unit != null && b.unit === unit) {
          b.targetHoverOffset = 0.35;
        } else {
          b.targetHoverOffset = 0.0;
        }
        // Emissive glow: bright on the direct hit, medium on chain siblings, restore otherwise
        const baseEmissive = b.baseEmissiveIntensity ?? b.mesh.material.emissive?.clone();
        if (!b.baseEmissiveIntensity && b.mesh.material.emissive) {
          b.baseEmissiveIntensity = b.mesh.material.emissiveIntensity || 0.08;
        }
        if (hitBlock && b === hitBlock) {
          b.targetEmissive = 0.55;
        } else if (unit != null && b.unit === unit) {
          b.targetEmissive = 0.3;
        } else {
          b.targetEmissive = b.baseEmissiveIntensity ?? 0.08;
        }
      });
    }
    this.renderer.domElement.style.cursor = cursor;
  }

  _onClick(e) {
    if (!this.controlsEnabled) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    
    const activeBlocks = this.blocks.filter(b => !b.isDivider);
    const hit = this.raycaster.intersectObjects(activeBlocks.map((b) => b.mesh), false)[0];
    if (hit) {
      const blk = activeBlocks.find((b) => b.mesh === hit.object);
      if (blk) this.hooks.onPlay(blk.layer);
    }
  }

  setHover(unit) {
    this.blocks.forEach((b) => {
      if (b.isDivider || b.isSoundBar) return; // speakers unaffected by hover
      const on = unit == null || b.unit === unit;
      if (b.mesh.material) b.mesh.material.opacity = on ? b.baseOp : 0.45;
      if (b.label) b.label.material.opacity = on ? 1 : 0.5;
    });
    this.ribbons.forEach((rb) => {
      const u = rb.lk ? rb.lk.unit : undefined;
      const on = unit == null || u === unit;
      rb.mesh.material.opacity = on
        ? (unit != null && u === unit ? 0.95 : rb.mesh.userData.baseOp)
        : 0.2;
    });
  }

  highlightLayer(idx) {
    this.activeLayerIdx = idx;
    this.blocks.forEach((b) => {
      if (b.isDivider) return;
      const on = idx < 0 || b.layer === idx;
      b.mesh.material.emissiveIntensity = on ? 1.0 : 0.22;
      b.mesh.scale.setScalar(idx >= 0 && b.layer === idx ? 1.06 : 1.0);
      
      // dip the cards in Z vertical axis to trigger a physical spring release bounce
      if (idx >= 0 && b.layer === idx) {
        b.playOffset = -0.45;
        b.playVelocity = 0.08;
      }
    });
  }

  _resize() {
    const w = this.c.clientWidth, h = this.c.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  _animate() {
    requestAnimationFrame(() => this._animate());
    
    // 1. Spotlights dynamic shimmer reflections (Y and Z swapped)
    if (this.p1 && this.p2) {
      const time = Date.now() * 0.001;
      this.p1.position.x = -22 + Math.cos(time * 0.4) * 4;
      this.p1.position.y = -18 + Math.sin(time * 0.4) * 4;
      this.p2.position.x = 22 + Math.sin(time * 0.4) * 4;
      this.p2.position.y = 18 + Math.cos(time * 0.4) * 4;
    }
    
    // 2. Easing transition factor
    let morphChanged = false;
    if (Math.abs(this.perspective - this.targetPerspective) > 0.0001) {
      this.perspective += (this.targetPerspective - this.perspective) * this.transitionSpeed;
      if (Math.abs(this.perspective - this.targetPerspective) < 0.0001) {
        this.perspective = this.targetPerspective;
      }
      morphChanged = true;
      if (this.hooks.onPerspectiveChange) {
        this.hooks.onPerspectiveChange(this.perspective);
      }
    }
    
    // Smooth rotation interpolation (inertia)
    if (this.targetTheta !== undefined && this.currentTheta !== undefined) {
      if (Math.abs(this.targetTheta - this.currentTheta) > 0.001) {
        this.currentTheta += (this.targetTheta - this.currentTheta) * 0.1;
        this._updateCameraPerspective(this.perspective, true);
      } else {
        this.currentTheta = this.targetTheta;
      }
    }
    
    // Smooth zoom interpolation (inertia)
    if (this.targetCamRadius !== null && this.camRadius !== null) {
      if (Math.abs(this.targetCamRadius - this.camRadius) > 0.01) {
        this.camRadius += (this.targetCamRadius - this.camRadius) * 0.12;
        this._updateCameraPerspective(this.perspective, true);
        if (this.hooks.onZoomChange) {
          this.hooks.onZoomChange(this.getZoom());
        }
      } else {
        this.camRadius = this.targetCamRadius;
        if (this.hooks.onZoomChange) {
          this.hooks.onZoomChange(this.getZoom());
        }
      }
    }
    
    // Pan momentum: friction decays the velocity so motion eases out smoothly
    // (no abrupt end), while repeated clicks accumulate into continuous glide.
    if (this.panVel.lengthSq() > 1e-5) {
      this.panOffset.addScaledVector(this.panVel, 1);
      this.panVel.multiplyScalar(0.90); // friction
      if (this.panVel.lengthSq() < 1e-5) this.panVel.set(0, 0, 0);
      this._updateCameraPerspective(this.perspective, true);
    }
    
    // 3. Update active spring physics (levitation and playback click-bounce in Z)
    const kSpring = 0.16;
    const dSpring = 0.80;
    const time = Date.now() * 0.001;
    this.blocks.forEach((b) => {
      if (b.isDivider) return;
      
      // Hover spring (smoothing)
      b.hoverOffset += (b.targetHoverOffset - b.hoverOffset) * 0.14;
      
      // Emissive glow spring (smoothing) — drives the hover highlight
      if (b.targetEmissive !== undefined && b.mesh.material.emissiveIntensity !== undefined) {
        b.mesh.material.emissiveIntensity += (b.targetEmissive - b.mesh.material.emissiveIntensity) * 0.15;
      }
      
      // Play dip spring (damped harmonic oscillation)
      const force = -kSpring * b.playOffset;
      b.playVelocity = (b.playVelocity + force) * dSpring;
      b.playOffset += b.playVelocity;

      // Speaker comes alive only while its layer is PLAYING (no hover effect):
      // the woofer cone pumps and the driver + LED glow.
      if (b.isSoundBar) {
        const isActive = this.activeLayerIdx === b.layer;
        if (b.driver) {
          const pump = isActive ? 1 + 0.22 * Math.abs(Math.sin(time * 9)) : 1;
          b.driver.scale.set(1, pump, 1);
          const g = isActive ? 0.6 : 0.15;
          b.driver.material.emissiveIntensity += (g - b.driver.material.emissiveIntensity) * 0.2;
        }
        if (b.tweeter) {
          const g = isActive ? 0.6 : 0.2;
          b.tweeter.material.emissiveIntensity += (g - b.tweeter.material.emissiveIntensity) * 0.2;
        }
        if (b.led) {
          const g = isActive ? 1.8 : 0.4;
          b.led.material.emissiveIntensity += (g - b.led.material.emissiveIntensity) * 0.2;
        }
      }
    });

    // 4. Always update positions/geometries to render animations in real-time
    if (this.data) {
      this._updateCardsPerspective(this.perspective);
      this.ribbons.forEach((rb) => this._updateRibbonGeometry(rb, this.perspective));
    }
    
    // 5. Update camera matrix on transition morph
    if (morphChanged) {
      this._updateCameraPerspective(this.perspective);
    }
    
    if (this.controls.enabled) {
      this.controls.update();
    }
    this.renderer.render(this.scene, this.camera);
  }
}
