import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { mixRGB } from "/static/app.js";

const col = (mix) => {
  const [r, g, b] = mixRGB(mix);
  return new THREE.Color(r / 255, g / 255, b / 255);
};

// world layout constants (Z is now vertical, Y is layer depth, X is horizontal width)
const LAYER_GAP = 7.0;     // spacing between layers along Y (depth)
const BLOCK_H = 2.0;       // vertical height (along Z)
const BLOCK_T = 0.55;      // thickness (along Y)
const WORLD_W = 26;        // total row width (along X)

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
    this.theta3D = null;
    
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
    this.scene.fog = new THREE.FogExp2(0x030408, 0.01);

    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 400);
    this.camera.up.set(0, 0, 1);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.5;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 80;
    this.controls.enableZoom = false; // Disable default zoom scroll to use custom combined scroll

    // Combined scroll handler: mouse wheel adjusts both perspective morph and camera closeness
    this.renderer.domElement.addEventListener("wheel", (e) => {
      e.preventDefault();
      const delta = -e.deltaY * 0.0012; // zoom scroll speed factor
      
      // Update target perspective factor
      this.targetPerspective = Math.max(0, Math.min(1, this.targetPerspective + delta));
      
      // Scale radius/closeness target in sync with perspective factor
      const depth = (this.data ? this.data.layers.length : 4) * LAYER_GAP;
      const minRadius = Math.max(12, depth * 0.45 + 9.5);
      const maxRadius = minRadius * 1.6;
      
      this.camRadius = Math.max(minRadius, Math.min(maxRadius, this.camRadius - delta * (maxRadius - minRadius) * 0.85));
      this._updateMorph();
    }, { passive: false });

    // Ambient light - deep tech console baseline
    this.scene.add(new THREE.AmbientLight(0x1a1c2e, 0.95));
    
    // Directional Key Light with shadow casting (Z is now vertical high-axis)
    const k = new THREE.DirectionalLight(0xffffff, 2.0);
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
    this.p1 = new THREE.PointLight(0xa855f7, 180, 100);
    this.p1.position.set(-22, -18, 10);
    this.scene.add(this.p1);

    this.p2 = new THREE.PointLight(0x1fe0d0, 180, 100);
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
    wCtx.strokeStyle = "rgba(18, 10, 5, 0.52)";
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
    const grid = new THREE.GridHelper(180, 45, 0x1fe0d0, 0x1c100b);
    grid.rotation.x = Math.PI / 2; // orient to X-Y plane
    grid.position.z = 0.001;
    grid.material.opacity = 0.035;
    grid.material.transparent = true;
    this.scene.add(grid);

    // 3. Ambient radial glow texture
    const c = document.createElement("canvas"); c.width = c.height = 512;
    const g = c.getContext("2d");
    const grd = g.createRadialGradient(256, 256, 10, 256, 256, 256);
    grd.addColorStop(0, "rgba(80,95,170,0.16)");
    grd.addColorStop(1, "rgba(3,4,8,0)");
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
      const chunks = [...layer.chunks].sort((a, b) => a.pos - b.pos);
      const lens = chunks.map((c) => Math.max(2.2, c.text.length));
      const tot = lens.reduce((a, b) => a + b, 0);
      const gap = 0.5;
      const totGap = gap * (chunks.length - 1);
      const scale = (WORLD_W - totGap) / tot;
      let x = -WORLD_W / 2;
      
      chunks.forEach((ch, i) => {
        const w = Math.max(2.0, lens[i] * scale);
        const cx = x + w / 2;
        const color = col(ch.mix);
        
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
        x += w + gap;
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
    const PX = 256, ratio = Math.max(1, Math.min(6, w / BLOCK_H));
    const cw = Math.round(PX * ratio), ch = PX;
    const cv = document.createElement("canvas"); cv.width = cw; cv.height = ch;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, cw, ch);
    let fs = 76, t = this._fit(text, 18);
    g.font = `600 ${fs}px 'Space Grotesk', system-ui, sans-serif`;
    g.fillStyle = "rgba(255,255,255,0.96)";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = 8;
    g.fillText(t, cw / 2, ch / 2);
    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.92, BLOCK_H * 0.92), mat);
    plane.renderOrder = 1;
    return plane;
  }
  
  _fit(t, max) { return t.length > max ? t.slice(0, max - 1) + "…" : t; }

  _ribbon(a, b, lk) {
    const N = 40;
    const geo = new THREE.BufferGeometry();
    const verts = new Float32Array((N + 1) * 6);
    const cols = new Float32Array((N + 1) * 6);
    
    // Interpolated gradient colors along ribbon length
    const colorA = a.mesh.material.color;
    const colorB = b.mesh.material.color;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const cc = colorA.clone().lerp(colorB, t);
      cols[i * 6] = cc.r; cols[i * 6 + 1] = cc.g; cols[i * 6 + 2] = cc.b;
      cols[i * 6 + 3] = cc.r; cols[i * 6 + 4] = cc.g; cols[i * 6 + 5] = cc.b;
    }

    const idx = [];
    for (let i = 0; i < N; i++) {
      const o = i * 2;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }

    geo.setAttribute("position", new THREE.BufferAttribute(verts, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(cols, 3));
    geo.setIndex(idx);

    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, 
      transparent: true,
      opacity: lk.kind === "keep" ? 0.16 : 0.34,
      side: THREE.DoubleSide, 
      depthWrite: false,
      blending: THREE.AdditiveBlending,
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
    
    // Connection points (previous bottom local -Z to next top local +Z)
    rb.a.mesh.localToWorld(p0.set(0, 0, -BLOCK_H / 2));
    rb.b.mesh.localToWorld(p3.set(0, 0, BLOCK_H / 2));

    const dy = p3.y - p0.y;
    const dz = p3.z - p0.z;
    const c1 = p0.clone().add(new THREE.Vector3(0, dy * 0.25, dz * 0.25));
    const c2 = p3.clone().add(new THREE.Vector3(0, -dy * 0.25, -dz * 0.25));
    
    const curve = new THREE.CubicBezierCurve3(p0, c1, c2, p3);
    const N = 40;
    const hw = Math.min(1.7, 0.7 + Math.abs(p3.x - p0.x) * 0.0 + 0.9);
    const pts = curve.getPoints(N);
    
    const geo = rb.mesh.geometry;
    const posAttr = geo.getAttribute("position");
    const verts = posAttr.array;

    let vIdx = 0;
    for (let i = 0; i <= N; i++) {
      const currT = i / N;
      const pt = pts[i].clone();
      
      // Add subtle ripple wave along Z (vertical axis)
      pt.z += Math.sin(currT * Math.PI * 2.0) * 0.28 * t;
      
      const tan = curve.getTangent(currT);
      const side = new THREE.Vector3().crossVectors(up, tan).normalize().multiplyScalar(hw);
      const L = pt.clone().add(side);
      const R = pt.clone().sub(side);
      
      verts[vIdx++] = L.x; verts[vIdx++] = L.y; verts[vIdx++] = L.z;
      verts[vIdx++] = R.x; verts[vIdx++] = R.y; verts[vIdx++] = R.z;
    }
    
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
  }

  _frameCamera(n) {
    const depth = (n - 1) * LAYER_GAP;
    // Radial distance and angled framing (theta3D = 60 degrees from vertical Z)
    this.camRadius = Math.max(15, depth * 0.46 + 11.0);
    this.theta3D = 1.05;
    this.currentTheta = 0; // Reset rotation on new load
    
    this.controls.target.set(0, 0, 1.0 * this.perspective);
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
    }
    
    if (t < 0.01) {
      // 2D Zenith View: lock controls, set camera overhead, up vector is rotated Y-back
      this.controls.enabled = false;
      this.camera.position.set(0, 0, this.camRadius);
      this.camera.up.set(Math.sin(azimuth), -Math.cos(azimuth), 0).normalize();
      this.controls.target.set(0, 0, 0);
    } else {
      // 3D Perspective View: enable controls, up vector is strictly Z-up
      this.controls.enabled = true;
      
      const phi = t * this.theta3D;
      const x = this.camRadius * Math.sin(phi) * Math.sin(azimuth);
      const y = this.camRadius * Math.sin(phi) * Math.cos(azimuth);
      const z = this.camRadius * Math.cos(phi);
      
      this.camera.position.set(
        this.controls.target.x + x,
        this.controls.target.y + y,
        this.controls.target.z + z
      );
      this.camera.up.set(0, 0, 1);
      this.controls.target.set(0, 0, 1.0 * t);
      
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

  zoomIn() {
    this.controls.dollyIn(1.15);
    this.controls.update();
    this.camRadius = this.camera.position.distanceTo(this.controls.target);
  }

  zoomOut() {
    this.controls.dollyOut(1.15);
    this.controls.update();
    this.camRadius = this.camera.position.distanceTo(this.controls.target);
  }

  rotateLeft() {
    this.currentTheta = (this.currentTheta || 0) + 0.15;
    this._updateMorph(true);
  }

  rotateRight() {
    this.currentTheta = (this.currentTheta || 0) - 0.15;
    this._updateMorph(true);
  }

  // ---- interaction
  _onMove(e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    this.pointer.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.pointer.y = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    
    // Filter out dividers for raycasting
    const activeBlocks = this.blocks.filter(b => !b.isDivider);
    const hit = this.raycaster.intersectObjects(activeBlocks.map((b) => b.mesh), false)[0];
    const hitBlock = hit ? activeBlocks.find((b) => b.mesh === hit.object) : null;
    const unit = hitBlock ? hitBlock.unit : null;
    
    if (unit !== this._hovered) {
      this._hovered = unit ?? null;
      this.hooks.onHover(this._hovered);
      this.renderer.domElement.style.cursor = unit != null ? "pointer" : "default";
      
      // Word Chain Levitation physics wave
      this.blocks.forEach((b) => {
        if (b.isDivider) return;
        if (hitBlock && b === hitBlock) {
          b.targetHoverOffset = 0.75;
        } else if (unit != null && b.unit === unit) {
          b.targetHoverOffset = 0.35;
        } else {
          b.targetHoverOffset = 0.0;
        }
      });
    }
  }

  _onClick(e) {
    if (this._hovered == null) return;
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
      if (b.isDivider) return;
      const on = unit == null || b.unit === unit;
      b.mesh.material.opacity = on ? b.baseOp : 0.08;
      b.label.material.opacity = on ? 1 : 0.12;
    });
    this.ribbons.forEach((rb) => {
      const on = unit == null || rb.unit === unit;
      rb.mesh.material.opacity = on ? (unit != null && rb.unit === unit ? 0.6 : rb.mesh.userData.baseOp) : 0.04;
    });
  }

  highlightLayer(idx) {
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
    
    // 3. Update active spring physics (levitation and playback click-bounce in Z)
    const kSpring = 0.16;
    const dSpring = 0.80;
    this.blocks.forEach((b) => {
      if (b.isDivider) return;
      
      // Hover spring (smoothing)
      b.hoverOffset += (b.targetHoverOffset - b.hoverOffset) * 0.14;
      
      // Play dip spring (damped harmonic oscillation)
      const force = -kSpring * b.playOffset;
      b.playVelocity = (b.playVelocity + force) * dSpring;
      b.playOffset += b.playVelocity;
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
