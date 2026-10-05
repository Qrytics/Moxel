import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MoxelDocument } from '../core/document/document';
import type { SkinModel } from '../core/document/types';
import type { CompositeCache } from '../core/render/compositeCache';
import { faceRect, FACES, skinParts, type FaceId, type PartDef } from '../minecraft/uv';

export type Limb = 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightLeg' | 'leftLeg';
export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'reset';
export type PreviewAnimation = 'none' | 'idle' | 'walk' | 'spin';

export interface PreviewOptions {
	parts: Record<Limb, boolean>;
	overlay: boolean;
	grid: boolean;
	lighting: boolean;
	background: string | 'transparent';
	animation: PreviewAnimation;
}

export const DEFAULT_PREVIEW_OPTIONS: PreviewOptions = {
	parts: { head: true, body: true, rightArm: true, leftArm: true, rightLeg: true, leftLeg: true },
	overlay: true,
	grid: true,
	lighting: true,
	background: 'transparent',
	animation: 'none'
};

export interface PaintHit {
	x: number;
	y: number;
	/** Whether the hit texel belongs to an outer-layer part. */
	overlay: boolean;
}

/**
 * Order three.js uses for BoxGeometry face groups: +x, -x, +y, -y, +z, -z. With the character
 * facing +z, its own right side is -x.
 */
const BOX_FACES: FaceId[] = ['left', 'right', 'top', 'bottom', 'front', 'back'];

/**
 * Assign skin UVs to a BoxGeometry. Each face's four vertices are ordered TL, TR, BL, BR as seen
 * from outside the box; the bottom face is the one exception, which Minecraft stores flipped.
 */
function applySkinUVs(geo: THREE.BoxGeometry, part: PartDef, texW: number, texH: number) {
	const uv = geo.attributes.uv as THREE.BufferAttribute;
	BOX_FACES.forEach((face, fi) => {
		const r = faceRect(part, face);
		const u0 = r.x / texW,
			u1 = (r.x + r.w) / texW;
		const v0 = 1 - r.y / texH,
			v1 = 1 - (r.y + r.h) / texH;
		const quad =
			face === 'bottom'
				? [
						[u0, v1],
						[u1, v1],
						[u0, v0],
						[u1, v0]
					]
				: [
						[u0, v0],
						[u1, v0],
						[u0, v1],
						[u1, v1]
					];
		quad.forEach(([u, v], k) => uv.setXY(fi * 4 + k, u, v));
	});
	uv.needsUpdate = true;
}

const LIMB_LAYOUT: Record<
	Limb,
	{ pivot: [number, number, number]; offset: (w: number) => [number, number, number] }
> = {
	head: { pivot: [0, 24, 0], offset: () => [0, 4, 0] },
	body: { pivot: [0, 24, 0], offset: () => [0, -6, 0] },
	rightArm: { pivot: [-5, 22, 0], offset: (w) => [-(w / 2 - 1), -4, 0] },
	leftArm: { pivot: [5, 22, 0], offset: (w) => [w / 2 - 1, -4, 0] },
	rightLeg: { pivot: [-2, 12, 0], offset: () => [0, -6, 0] },
	leftLeg: { pivot: [2, 12, 0], offset: () => [0, -6, 0] }
};

export class Preview3D {
	readonly renderer: THREE.WebGLRenderer;
	readonly scene = new THREE.Scene();
	readonly camera = new THREE.PerspectiveCamera(32, 1, 0.5, 1000);
	readonly controls: OrbitControls;
	private texture: THREE.CanvasTexture;
	private root = new THREE.Group();
	private grid: THREE.GridHelper;
	private ambient = new THREE.AmbientLight(0xffffff, 1.6);
	private sun = new THREE.DirectionalLight(0xffffff, 2.2);
	private fill = new THREE.DirectionalLight(0xbfd4ff, 0.8);
	private limbs = new Map<Limb, THREE.Group>();
	private overlayMeshes: THREE.Mesh[] = [];
	private pickables: THREE.Mesh[] = [];
	private voxels: THREE.InstancedMesh | null = null;
	private litMaterials: THREE.Material[] = [];
	private flatMaterials: THREE.Material[] = [];
	private raf = 0;
	private needsRender = true;
	private clock = new THREE.Clock();
	private unsubCache: () => void;
	private resizeObs: ResizeObserver;
	private mode: 'skin' | 'cube' | 'voxels' | 'plane' = 'plane';
	private model: SkinModel = 'classic';
	options: PreviewOptions = structuredClone(DEFAULT_PREVIEW_OPTIONS);
	private disposed = false;
	private center = new THREE.Vector3(0, 16, 0);
	private distance = 70;

	constructor(
		readonly container: HTMLElement,
		private doc: MoxelDocument,
		private cache: CompositeCache
	) {
		this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
		this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;
		this.renderer.domElement.className = 'preview3d-canvas';
		container.appendChild(this.renderer.domElement);

		this.texture = new THREE.CanvasTexture(cache.canvas);
		this.texture.magFilter = THREE.NearestFilter;
		this.texture.minFilter = THREE.NearestFilter;
		this.texture.generateMipmaps = false;
		this.texture.colorSpace = THREE.SRGBColorSpace;

		this.sun.position.set(30, 60, 50);
		this.fill.position.set(-40, 20, -30);
		this.scene.add(this.ambient, this.sun, this.fill, this.root);
		this.grid = new THREE.GridHelper(64, 16, 0x5c6370, 0x3a3f4b);
		(this.grid.material as THREE.Material).transparent = true;
		(this.grid.material as THREE.Material).opacity = 0.6;
		this.scene.add(this.grid);

		this.controls = new OrbitControls(this.camera, this.renderer.domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.12;
		this.controls.screenSpacePanning = true;
		this.controls.addEventListener('change', () => this.invalidate());

		this.unsubCache = cache.subscribe(() => this.onTextureChanged());
		this.resizeObs = new ResizeObserver(() => this.resize());
		this.resizeObs.observe(container);
		this.rebuild();
		this.resize();
		this.setView('reset');
		this.loop();
	}

	dispose() {
		this.disposed = true;
		cancelAnimationFrame(this.raf);
		this.unsubCache();
		this.resizeObs.disconnect();
		this.controls.dispose();
		this.clearModel();
		this.texture.dispose();
		this.renderer.dispose();
		this.renderer.domElement.remove();
	}

	setDocument(doc: MoxelDocument, cache: CompositeCache) {
		this.doc = doc;
		this.unsubCache();
		this.cache = cache;
		this.unsubCache = cache.subscribe(() => this.onTextureChanged());
		this.rebuild();
	}

	setOptions(o: Partial<PreviewOptions>) {
		this.options = { ...this.options, ...o, parts: { ...this.options.parts, ...o.parts } };
		this.applyOptions();
	}

	/** Re-read model type / document kind (e.g. after switching classic ↔ slim). */
	rebuild() {
		this.clearModel();
		const d = this.doc;
		const isSkin = d.meta.kind === 'skin' && d.width === 64 && d.height === 64;
		this.model = d.meta.skin?.model ?? 'classic';
		if (isSkin) this.mode = 'skin';
		else if (d.meta.texture?.type === 'block' && d.width === d.height) this.mode = 'cube';
		else if (d.width <= 64 && d.height <= 64) this.mode = 'voxels';
		else this.mode = 'plane';
		this.texture.image = this.cache.canvas;
		this.texture.needsUpdate = true;
		if (this.mode === 'skin') this.buildSkin();
		else if (this.mode === 'cube') this.buildCube();
		else if (this.mode === 'voxels') this.buildVoxels();
		else this.buildPlane();
		this.applyOptions();
		this.setView('reset');
	}

	private mat(overlay: boolean) {
		const common = {
			map: this.texture,
			transparent: true,
			alphaTest: 0.01,
			side: overlay ? THREE.DoubleSide : THREE.FrontSide
		};
		const lit = new THREE.MeshLambertMaterial(common);
		const flat = new THREE.MeshBasicMaterial(common);
		this.litMaterials.push(lit);
		this.flatMaterials.push(flat);
		return lit;
	}

	private buildSkin() {
		const tex = { w: 64, h: 64 };
		const parts = skinParts(this.model);
		for (const limb of Object.keys(LIMB_LAYOUT) as Limb[]) {
			const g = new THREE.Group();
			g.position.set(...LIMB_LAYOUT[limb].pivot);
			g.name = limb;
			this.limbs.set(limb, g);
			this.root.add(g);
		}
		for (const p of parts) {
			const inflate = p.overlay ? (p.limb === 'head' ? 1 : 0.5) : 0;
			const geo = new THREE.BoxGeometry(p.w + inflate, p.h + inflate, p.d + inflate);
			applySkinUVs(geo, p, tex.w, tex.h);
			const mesh = new THREE.Mesh(geo, this.mat(p.overlay));
			mesh.position.set(...LIMB_LAYOUT[p.limb].offset(p.w));
			mesh.userData = { part: p };
			mesh.renderOrder = p.overlay ? 1 : 0;
			this.limbs.get(p.limb)!.add(mesh);
			this.pickables.push(mesh);
			if (p.overlay) this.overlayMeshes.push(mesh);
			else {
				// Faint outline so a blank skin still shows the character's shape.
				const edges = new THREE.LineSegments(
					new THREE.EdgesGeometry(geo),
					new THREE.LineBasicMaterial({ color: 0x8b93a7, transparent: true, opacity: 0.25 })
				);
				edges.position.copy(mesh.position);
				edges.userData = { outline: true };
				this.limbs.get(p.limb)!.add(edges);
			}
		}
		this.center.set(0, 16, 0);
		this.distance = 78;
		this.grid.position.y = 0;
	}

	private buildCube() {
		const geo = new THREE.BoxGeometry(16, 16, 16);
		const mesh = new THREE.Mesh(geo, this.mat(false));
		mesh.position.set(0, 8, 0);
		mesh.userData = { cube: true };
		this.root.add(mesh);
		this.pickables.push(mesh);
		this.center.set(0, 8, 0);
		this.distance = 58;
		this.grid.position.y = 0;
	}

	private buildPlane() {
		const { width: w, height: h } = this.doc;
		const s = 32 / Math.max(w, h);
		const geo = new THREE.PlaneGeometry(w * s, h * s);
		const mesh = new THREE.Mesh(geo, this.mat(true));
		mesh.position.set(0, (h * s) / 2 + 2, 0);
		mesh.userData = { plane: true };
		this.root.add(mesh);
		this.pickables.push(mesh);
		this.center.set(0, (h * s) / 2 + 2, 0);
		this.distance = 70;
	}

	/** Items and sprites: extrude every opaque pixel into a voxel, like in-game held items. */
	private buildVoxels() {
		const { width: w, height: h } = this.doc;
		const s = 24 / Math.max(w, h);
		const geo = new THREE.BoxGeometry(s, s, s);
		const lit = new THREE.MeshLambertMaterial({ vertexColors: false });
		const flat = new THREE.MeshBasicMaterial();
		this.litMaterials.push(lit);
		this.flatMaterials.push(flat);
		this.voxels = new THREE.InstancedMesh(geo, lit, w * h);
		this.voxels.userData = { voxelScale: s };
		this.root.add(this.voxels);
		this.pickables.push(this.voxels);
		this.updateVoxels();
		this.center.set(0, (h * s) / 2 + 2, 0);
		this.distance = 62;
	}

	private updateVoxels() {
		const v = this.voxels;
		if (!v) return;
		const { width: w, height: h } = this.doc;
		const s = v.userData.voxelScale as number;
		const data = this.cache.frameData(this.cache.activeFrame);
		const m = new THREE.Matrix4();
		const c = new THREE.Color();
		let n = 0;
		for (let y = 0; y < h; y++)
			for (let x = 0; x < w; x++) {
				const i = (y * w + x) * 4;
				if (data[i + 3] < 32) continue;
				m.makeTranslation((x - w / 2 + 0.5) * s, (h - y - 0.5) * s + 2, 0);
				v.setMatrixAt(n, m);
				c.setRGB(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255, THREE.SRGBColorSpace);
				v.setColorAt(n, c);
				n++;
			}
		v.count = n;
		v.instanceMatrix.needsUpdate = true;
		if (v.instanceColor) v.instanceColor.needsUpdate = true;
		v.computeBoundingSphere();
	}

	private clearModel() {
		this.root.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.geometry) m.geometry.dispose();
			const mat = m.material as THREE.Material | THREE.Material[] | undefined;
			if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
			else mat?.dispose();
		});
		this.root.clear();
		this.limbs.clear();
		this.overlayMeshes = [];
		this.pickables = [];
		this.voxels = null;
		this.litMaterials.forEach((m) => m.dispose());
		this.flatMaterials.forEach((m) => m.dispose());
		this.litMaterials = [];
		this.flatMaterials = [];
	}

	private applyOptions() {
		const o = this.options;
		for (const [limb, g] of this.limbs) g.visible = o.parts[limb];
		for (const m of this.overlayMeshes) m.visible = o.overlay;
		this.grid.visible = o.grid;
		// Swap materials for unlit (flat) rendering.
		this.root.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (!mesh.isMesh) return;
			const cur = mesh.material as THREE.Material;
			const li = this.litMaterials.indexOf(cur);
			const fi = this.flatMaterials.indexOf(cur);
			if (o.lighting && fi >= 0) mesh.material = this.litMaterials[fi];
			if (!o.lighting && li >= 0) mesh.material = this.flatMaterials[li];
		});
		if (o.background === 'transparent') this.renderer.setClearColor(0x000000, 0);
		else this.renderer.setClearColor(new THREE.Color(o.background), 1);
		if (o.animation === 'none') this.resetPose();
		this.invalidate();
	}

	private resetPose() {
		for (const g of this.limbs.values()) g.rotation.set(0, 0, 0);
		this.root.rotation.set(0, 0, 0);
	}

	/** In paint mode the left button paints, so orbiting moves to the right button. */
	setPaintMode(on: boolean) {
		this.controls.mouseButtons = on
			? { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE }
			: { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
		this.controls.touches = on
			? { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE }
			: { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
	}

	setView(v: ViewPreset) {
		const d = this.distance;
		const c = this.center;
		const pos: Record<ViewPreset, [number, number, number]> = {
			front: [0, 0, d],
			back: [0, 0, -d],
			left: [d, 0, 0], // the character's left side faces +x
			right: [-d, 0, 0],
			reset: [d * 0.55, d * 0.22, d * 0.8]
		};
		const p = pos[v];
		this.camera.position.set(c.x + p[0], c.y + p[1], c.z + p[2]);
		this.controls.target.copy(c);
		this.controls.update();
		this.invalidate();
	}

	private onTextureChanged() {
		if (this.texture.image !== this.cache.canvas) this.texture.image = this.cache.canvas;
		this.texture.needsUpdate = true;
		if (this.mode === 'voxels') this.updateVoxels();
		this.invalidate();
	}

	invalidate() {
		this.needsRender = true;
	}

	private resize() {
		const w = this.container.clientWidth,
			h = this.container.clientHeight;
		if (!w || !h) return;
		this.renderer.setSize(w, h, false);
		this.renderer.domElement.style.width = '100%';
		this.renderer.domElement.style.height = '100%';
		this.camera.aspect = w / h;
		this.camera.updateProjectionMatrix();
		this.invalidate();
	}

	private loop = () => {
		if (this.disposed) return;
		this.raf = requestAnimationFrame(this.loop);
		const dt = this.clock.getDelta();
		const t = this.clock.elapsedTime;
		const anim = this.options.animation;
		if (anim !== 'none') {
			this.animate(anim, t, dt);
			this.needsRender = true;
		}
		if (this.controls.update()) this.needsRender = true;
		if (!this.needsRender) return;
		this.needsRender = false;
		this.renderer.render(this.scene, this.camera);
	};

	private animate(anim: PreviewAnimation, t: number, dt: number) {
		const L = this.limbs;
		if (anim === 'spin') {
			this.root.rotation.y += dt * 0.8;
			return;
		}
		const swing = anim === 'walk' ? Math.sin(t * 6) * 0.7 : Math.sin(t * 1.5) * 0.05;
		L.get('rightArm')?.rotation.set(-swing, 0, anim === 'idle' ? 0.05 + Math.sin(t * 1.2) * 0.03 : 0);
		L.get('leftArm')?.rotation.set(swing, 0, anim === 'idle' ? -0.05 - Math.sin(t * 1.2) * 0.03 : 0);
		L.get('rightLeg')?.rotation.set(anim === 'walk' ? swing : 0, 0, 0);
		L.get('leftLeg')?.rotation.set(anim === 'walk' ? -swing : 0, 0, 0);
		L.get('head')?.rotation.set(
			anim === 'walk' ? Math.sin(t * 12) * 0.03 : Math.sin(t * 0.7) * 0.06,
			Math.sin(t * 0.5) * 0.15,
			0
		);
	}

	/** Raycast a screen point to a texture texel (for painting directly on the model). */
	pick(clientX: number, clientY: number, preferOverlay: boolean): PaintHit | null {
		const rect = this.renderer.domElement.getBoundingClientRect();
		const ndc = new THREE.Vector2(
			((clientX - rect.left) / rect.width) * 2 - 1,
			-((clientY - rect.top) / rect.height) * 2 + 1
		);
		const ray = new THREE.Raycaster();
		ray.setFromCamera(ndc, this.camera);
		const visible = this.pickables.filter((m) => {
			let o: THREE.Object3D | null = m;
			while (o) {
				if (!o.visible) return false;
				o = o.parent;
			}
			return true;
		});
		const hits = ray.intersectObjects(visible, false);
		const { width: W, height: H } = this.doc;
		const data = this.cache.frameData(this.cache.activeFrame);
		for (const h of hits) {
			if (h.object === this.voxels && h.instanceId !== undefined) {
				const s = this.voxels!.userData.voxelScale as number;
				const m = new THREE.Matrix4();
				this.voxels!.getMatrixAt(h.instanceId, m);
				const pos = new THREE.Vector3().setFromMatrixPosition(m);
				const x = Math.round(pos.x / s + W / 2 - 0.5);
				const y = Math.round(H - 0.5 - (pos.y - 2) / s);
				return { x, y, overlay: false };
			}
			if (!h.uv) continue;
			let x = Math.floor(h.uv.x * W);
			let y = Math.floor((1 - h.uv.y) * H);
			const part = h.object.userData.part as PartDef | undefined;
			if (part && h.face) {
				// Clamp into the face's rect so hits on an edge never land on a neighbouring face.
				const r = faceRect(part, BOX_FACES[h.face.materialIndex]);
				x = Math.min(r.x + r.w - 1, Math.max(r.x, x));
				y = Math.min(r.y + r.h - 1, Math.max(r.y, y));
				if (part.overlay) {
					const opaque = data[(y * W + x) * 4 + 3] > 0;
					if (!opaque && !preferOverlay) continue;
				}
			}
			x = Math.min(W - 1, Math.max(0, x));
			y = Math.min(H - 1, Math.max(0, y));
			return { x, y, overlay: !!part?.overlay };
		}
		return null;
	}

	/** PNG snapshot of the current render. */
	snapshot(): Promise<Blob | null> {
		this.renderer.render(this.scene, this.camera);
		return new Promise((resolve) => this.renderer.domElement.toBlob(resolve, 'image/png'));
	}
}

export { FACES };
