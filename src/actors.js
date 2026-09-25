import * as pc from 'playcanvas';
import { Character, Animation } from '@viggle/splat-engine';
import { solidCharacter } from './splat-opacity.js';
import { cylMesh } from './geo.js';

// Library clips face -Z; PINOC text-to-motion clips face +Z. Turn root + pelvis of generated clips once at load.
const TURN = new pc.Mat4().setFromEulerAngles(0, 180, 0);
function prepare(animation, generated) {
  if (!generated) return animation;
  const m = new pc.Mat4();
  for (let f = 0; f < animation.numFrames; f++) for (const bone of [0, 1]) {
    const o = (f * animation.numBones + bone) * 16;
    m.data.set(animation.data.subarray(o, o + 16)); m.mul2(TURN, m); animation.data.set(m.data, o);
  }
  return animation;
}

export async function loadClips(scene, list) {
  const have = new Set();
  await Promise.all(list.map(async name => {
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}motions/${name}.glb`); if (!r.ok) return;
      prepare(Animation.fromGlb(await r.arrayBuffer()), name.startsWith('gen_')).register(scene, name); have.add(name);
    } catch (e) { console.warn('clip', name, e); }
  }));
  return have;
}

// Capsules along the skeleton, drawn only into the sun's shadow map, so splat actors throw mesh shadows.
const SEGS = [['pelvis', 'spine_05', .15], ['spine_05', 'head', .085], ['upperarm_l', 'lowerarm_l', .05], ['lowerarm_l', 'hand_l', .04],
  ['upperarm_r', 'lowerarm_r', .05], ['lowerarm_r', 'hand_r', .04], ['thigh_l', 'calf_l', .07], ['calf_l', 'foot_l', .05], ['foot_l', 'ball_l', .04],
  ['thigh_r', 'calf_r', .07], ['calf_r', 'foot_r', .05], ['foot_r', 'ball_r', .04], ['clavicle_l', 'clavicle_r', .06]];
let proxyMat = null;
class ShadowProxy {
  constructor(actor, layer) {
    const d = actor.app.graphicsDevice;
    if (!proxyMat) { proxyMat = new pc.StandardMaterial(); proxyMat.update(); }
    this.a = actor; this.root = new pc.Entity('shadowProxy'); actor.app.root.addChild(this.root);
    const unit = cylMesh(d, 1, 1, 8, 1, 1);
    const mk = () => { const e = new pc.Entity(); e.addComponent('render', { meshInstances: [new pc.MeshInstance(unit, proxyMat)], castShadows: true, receiveShadows: false, layers: [layer.id] }); this.root.addChild(e); return e; };
    this.segs = SEGS.map(([a, b, r]) => ({ a: actor.bone(a), b: actor.bone(b), r, e: mk() })).filter(s => s.a >= 0 && s.b >= 0);
    this.head = actor.bone('head'); this.skull = mk();
    this.pa = new pc.Vec3(); this.pb = new pc.Vec3(); this.q = new pc.Quat(); this.up = new pc.Vec3(0, 1, 0); this.dir = new pc.Vec3(); this.ax = new pc.Vec3();
  }
  update() {
    const arm = this.a.ch.armature, on = this.a.visible; this.root.enabled = on; if (!on) return;
    for (const s of this.segs) {
      const A = arm.getBoneWorldMatrix(s.a), B = arm.getBoneWorldMatrix(s.b); if (!A || !B) continue;
      A.getTranslation(this.pa); B.getTranslation(this.pb);
      const dir = this.dir.sub2(this.pb, this.pa), len = dir.length(); if (len < 1e-4) continue; dir.mulScalar(1 / len);
      const ax = this.ax.cross(this.up, dir);
      if (ax.lengthSq() < 1e-8) this.q.setFromEulerAngles(dir.y > 0 ? 0 : 180, 0, 0);
      else this.q.setFromAxisAngle(ax.normalize(), Math.acos(Math.max(-1, Math.min(1, dir.y))) * 57.2958);
      s.e.setPosition(this.pa); s.e.setRotation(this.q); s.e.setLocalScale(s.r, len, s.r);
    }
    const H = arm.getBoneWorldMatrix(this.head);
    if (H) { H.getTranslation(this.pa); this.skull.setPosition(this.pa.x, this.pa.y - .02, this.pa.z); this.skull.setEulerAngles(0, 0, 0); this.skull.setLocalScale(.1, .24, .1); }
  }
}

// A PINOC splat character with game-side position, yaw/lean, clip switching and a shadow proxy.
export class Actor {
  constructor(game, ch, name) {
    this.game = game; this.ch = ch; this.name = name; this.app = game.scene.app;
    this.x = 0; this.y = 0; this.z = 0; this.yaw = 0; this.roll = 0; this.pitch = 0; this.anim = null; this.visible = true; this.groundOffset = 0;
    const names = ch.armature.rigBoneNames?.length ? ch.armature.rigBoneNames : ch.armature.boneNames;
    this.bone = n => names.indexOf(n);
    // every clip plays in place: the game owns forward motion
    ch.armature.rootMotionMode = 'extract';
    if (game.world?.proxyLayer) this.shadow = new ShadowProxy(this, game.world.proxyLayer);
  }
  show(v) { this.visible = v; this.ch.setActive(v); this.ch.splat.setRenderingEnabled(v); }
  play(name, { loop = true, fade = .15, speed = 1, restart = false, at = null } = {}) {
    if (this.anim === name && loop && !restart) { this.ch.playbackSpeed = speed; return; }
    this.anim = name; this.ch.crossfadeTo(name, { duration: fade, loop, rootMotion: false });
    this.ch.armature.rootMotionMode = 'extract';
    this.ch.playbackSpeed = speed;
    if (at != null) this.ch.armature.animationTime = at * (this.ch.armature.frameRate || 30); // engine time is in frames
  }
  set lockY(v) { this.ch.armature.lockPelvisY = v; }
  groundCalibrate() {
    const y = this.ch.getLowestWorldY(.002);
    if (Number.isFinite(y)) this.groundOffset = Math.max(-.4, Math.min(.4, this.groundOffset + (this.y + .01 - y)));
  }
  update() {
    this.ch.armature.consumeRootMotionDelta?.();
    this.ch.setPosition(this.x, this.y + this.groundOffset, this.z);
    this.ch.setRotation(this.pitch, this.yaw, this.roll);
    this.shadow?.update();
  }
}

export async function loadActor(game, file, name) {
  const url = /\.vsplat(\?|$)/.test(file) ? file : `${import.meta.env.BASE_URL}characters/${file}.vsplat?v=3`;
  const ch = await Character.load(game.scene, url, { name });
  solidCharacter(ch, 2.2);
  return new Actor(game, ch, name);
}
