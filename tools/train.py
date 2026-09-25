# Procedural Momiji Line EMU: a double-ended Japanese local car, built in Blender and exported to public/models/train.glb.
#   /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/train.py -- [--render out.png]
# Blender axes: X across (width), Y along the car (front cab at Y=0, rear at Y=L), Z up; rail top at Z=0.22.
# glTF export turns this into +Y up with the front at z=0 and the body along -z, which is what obstacles.js expects.
import bpy, bmesh, math, sys, os
from mathutils import Vector, Matrix

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'models', 'train.glb')
L = 15.0            # car length (m), matches TRAIN_LEN
FLOOR = 1.12        # bottom of the body shell
WAIST = 1.86        # maroon below, gold pinstripe, cream above
RAKE = 0.16         # windscreen lean-back per metre of height above Z=2.0
DOORS = [3.4, L - 3.4]
DOOR_W = 1.3

# ---------------------------------------------------------------- scene reset
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
col = bpy.data.collections.new('train'); scene.collection.children.link(col)
cutters = bpy.data.collections.new('cutters'); scene.collection.children.link(cutters)

# ---------------------------------------------------------------- materials
MATS = {}
def mat(name, color, rough=.5, metal=0., emit=None, emit_str=0., alpha=1.):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal
    if emit: p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = emit_str
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha
        m.surface_render_method = 'BLENDED'
    MATS[name] = m; return m

def srgb(h):  # '#rrggbb' -> linear tuple
    c = [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(x / 12.92 if x <= .04045 else ((x + .055) / 1.055) ** 2.4 for x in c)

mat('paint_upper', srgb('#efe6cf'), .28)
mat('paint_lower', srgb('#8a1a1c'), .26)
mat('paint_stripe', srgb('#d6a646'), .3, .7)
mat('roof', srgb('#6b6a68'), .62, .2)
mat('interior', srgb('#e2dccd'), .8)
mat('cab', srgb('#2b2c2e'), .7)
mat('glass', srgb('#1c2a30'), .04, .0, alpha=.38)
mat('rubber', srgb('#141414'), .75)
mat('chrome', srgb('#d8d8d8'), .12, 1.)
mat('underframe', srgb('#262628'), .55, .4)
mat('skirt', srgb('#4a4b4e'), .5, .3)
mat('bogie', srgb('#1b1b1c'), .5, .35)
mat('wheel', srgb('#8a8580'), .32, .95)
mat('headlight', srgb('#fff6dc'), .1, 0., srgb('#fff2cc'), 6.)
mat('taillight', srgb('#7a0d0a'), .2, 0., srgb('#ff2a16'), .6)
mat('dest', srgb('#101010'), .3, 0., srgb('#ffffff'), 1.)
mat('seat', srgb('#2f5a45'), .9)
mat('floor', srgb('#5e5146'), .7)
mat('ceiling_light', srgb('#fff4dd'), .3, 0., srgb('#fff1d6'), 3.)
mat('grille', srgb('#9a9892'), .45, .6)
mat('decal', srgb('#f3e3b6'), .4)

def obj_from_bm(bm, name, material=None):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me); col.objects.link(ob)
    if material: me.materials.append(MATS[material])
    return ob

def add_mats(ob, names):
    for n in names: ob.data.materials.append(MATS[n])

def select_only(ob):
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob

def apply_mods(ob):
    select_only(ob)
    for m in list(ob.modifiers): bpy.ops.object.modifier_apply(modifier=m.name)

def smooth(ob, angle=38):
    select_only(ob); bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))

# primitive helpers (all return objects in `col`, material assigned)
def box(name, size, loc, material, bevel=0., rot=(0, 0, 0), segs=2):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    ob = obj_from_bm(bm, name, material); ob.location = loc; ob.rotation_euler = rot
    if bevel:
        m = ob.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = segs; m.limit_method = 'ANGLE'
        apply_mods(ob); smooth(ob)
    return ob

def cyl(name, r, depth, loc, material, rot=(0, 0, 0), verts=24, r2=None, bevel=0.):
    bm = bmesh.new(); bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    ob = obj_from_bm(bm, name, material); ob.location = loc; ob.rotation_euler = rot
    if bevel:
        m = ob.modifiers.new('bev', 'BEVEL'); m.width = bevel; m.segments = 2; m.limit_method = 'ANGLE'
        apply_mods(ob)
    smooth(ob, 50)
    return ob

def tube(name, pts, r, material, verts=8):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = 2; cu.use_fill_caps = True
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts): p.co = (*q, 1)
    ob = bpy.data.objects.new(name, cu); col.objects.link(ob)
    select_only(ob); bpy.ops.object.convert(target='MESH'); ob = bpy.context.view_layer.objects.active
    ob.data.materials.clear(); ob.data.materials.append(MATS[material]); smooth(ob, 60)
    return ob

# ---------------------------------------------------------------- body shell
def profile():
    half = [(0, FLOOR), (1.2, FLOOR), (1.27, FLOOR + .02), (1.31, FLOOR + .09), (1.33, 1.45), (1.34, 1.8), (1.338, 2.2), (1.328, 2.5), (1.312, 2.72)]
    cx, cz, r = .95, 2.74, .362
    for a in (12, 26, 40, 54, 68, 80):
        t = math.radians(a); half.append((cx + r * math.cos(t), cz + r * math.sin(t)))
    for x in (.8, .62, .42, .21):
        half.append((x, 3.3 - (x / .95) ** 2 * .2))
    half.append((0, 3.3))
    ring = half + [(-x, z) for x, z in reversed(half[1:-1])]
    return ring  # closed ring, bottom-centre first, anticlockwise seen from the front

def nose(u):
    """u = distance from the nearest end (0 at the face). Returns (x scale, z-top scale, rake weight)."""
    k = max(0., 1 - u / .75)
    return 1 - .1 * k ** 1.6, 1 - .03 * k ** 1.5, k

def build_shell():
    ring = profile(); n = len(ring)
    ys = [0, .04, .12, .25, .42, .6, .75, L - .75, L - .6, L - .42, L - .25, L - .12, L - .04, L]
    bm = bmesh.new(); rows = []
    for y in ys:
        u = min(y, L - y); sx, sz, k = nose(u); row = []
        for x, z in ring:
            zz = 1.8 + (z - 1.8) * sz if z > 1.8 else z
            off = RAKE * max(0, zz - 2.0) * k * (1 if y < L / 2 else -1)
            row.append(bm.verts.new((x * sx, y + off, zz)))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    # end caps: fan to a centre vertex so the raked face stays smooth
    for row, flip in ((rows[0], True), (rows[-1], False)):
        c = sum((v.co for v in row), Vector()) / n
        cv = bm.verts.new(c)
        for i in range(n):
            f = (row[i], row[(i + 1) % n], cv)
            bm.faces.new(f if not flip else tuple(reversed(f)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # split along livery lines so each band is its own faces
    geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    for z in (WAIST, WAIST + .06, 2.93):
        res = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, z), plane_no=(0, 0, 1))
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
    ob = obj_from_bm(bm, 'shell'); add_mats(ob, ['paint_upper', 'paint_lower', 'paint_stripe', 'roof', 'interior'])
    livery(ob)
    return ob

def livery(ob, roof=True):
    for f in ob.data.polygons:
        z = f.center.z
        f.material_index = 1 if z < WAIST else 2 if z < WAIST + .06 else (3 if roof and z > 2.93 else 0)

shell = build_shell()
sol = shell.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = .055; sol.offset = -1; sol.use_even_offset = True
sol.material_offset = 4  # inner wall -> 'interior' (index 4); clamps for indices past the end
apply_mods(shell)
for f in shell.data.polygons:
    if f.material_index > 4: f.material_index = 4

# ---------------------------------------------------------------- openings (windows, doors, windscreens)
def cutter(name, x0, x1, y0, y1, z0, z1, radius=.07, axis='X'):
    ob = box(name, (x1 - x0, y1 - y0, z1 - z0), ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), 'rubber')
    m = ob.modifiers.new('r', 'BEVEL'); m.width = radius; m.segments = 4; m.affect = 'EDGES'
    m.limit_method = 'ANGLE'; m.angle_limit = math.radians(60)
    # round only the edges parallel to the cut direction
    apply_mods(ob)
    col.objects.unlink(ob); cutters.objects.link(ob); return ob

side_windows = []  # (y0, y1, z0, z1)
WZ = (1.97, 2.68)
side_windows += [(.95, 2.35, 2.02, 2.68)]                     # cab side window
for i in range(4): side_windows.append((4.55 + i * 1.5, 5.85 + i * 1.5, *WZ))
side_windows += [(L - 2.35, L - .95, 2.02, 2.68)]
doors = [(d - DOOR_W / 2, d + DOOR_W / 2, FLOOR - .01, 2.84) for d in DOORS]
for s in (-1, 1):
    for i, (y0, y1, z0, z1) in enumerate(side_windows): cutter(f'cw{s}{i}', 1.0 * s - .4, 1.0 * s + .4, y0, y1, z0, z1)
    for i, (y0, y1, z0, z1) in enumerate(doors): cutter(f'cd{s}{i}', 1.0 * s - .4, 1.0 * s + .4, y0, y1, z0, z1, radius=.05)
# windscreens both ends: two big panes and the gangway-door window
for end in (0, 1):
    y0, y1 = (-.6, .5) if end == 0 else (L - .5, L + .6)
    for x0, x1 in ((-1.1, -.36), (.36, 1.1)): cutter(f'ws{end}{x0}', x0, x1, y0, y1, 1.98, 2.86, radius=.1)
    cutter(f'wg{end}', -.24, .24, y0, y1, 2.02, 2.74, radius=.06)
    cutter(f'dst{end}', -.42, .42, y0 + (.25 if end == 0 else -.25), y1 + (.25 if end == 0 else -.25), 2.93, 3.1, radius=.03)
bl = shell.modifiers.new('cut', 'BOOLEAN'); bl.operation = 'DIFFERENCE'; bl.operand_type = 'COLLECTION'; bl.collection = cutters; bl.solver = 'EXACT'
apply_mods(shell)
smooth(shell, 34)
bpy.data.collections.remove(cutters)
for o in [o for o in bpy.data.objects if o.name.startswith(('cw', 'cd', 'ws', 'wg', 'dst'))]: bpy.data.objects.remove(o)

def front_y(z, end=0):
    """Surface Y of the cab face at height z (outer skin)."""
    off = RAKE * max(0, z - 2.0)
    return -0 + off if end == 0 else L - off

# ---------------------------------------------------------------- glass + gaskets
def pane(name, pts, material='glass'):
    bm = bmesh.new(); vs = [bm.verts.new(p) for p in pts]; bm.faces.new(vs)
    return obj_from_bm(bm, name, material)

for s in (-1, 1):
    x = s * 1.305
    for i, (y0, y1, z0, z1) in enumerate(side_windows):
        g = pane(f'glass{s}{i}', [(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)] if s > 0 else [(x, y1, z0), (x, y0, z0), (x, y0, z1), (x, y1, z1)])
        # frame: dark gasket + a thin horizontal transom on the big windows
        for yy in (y0, y1): box(f'gk{s}{i}{yy}', (.03, .025, z1 - z0), (s * 1.315, yy + (.012 if yy == y0 else -.012), (z0 + z1) / 2), 'rubber')
        for zz in (z0, z1): box(f'gz{s}{i}{zz}', (.03, y1 - y0, .025), (s * 1.315, (y0 + y1) / 2, zz + (.012 if zz == z0 else -.012)), 'rubber')
        if y1 - y0 > 1.2: box(f'tr{s}{i}', (.035, y1 - y0, .04), (s * 1.31, (y0 + y1) / 2, 2.44), 'chrome')

# windscreens: glass follows the rake
for end in (0, 1):
    sgn = 1 if end == 0 else -1
    for x0, x1, z0, z1 in ((-1.1, -.36, 1.98, 2.86), (.36, 1.1, 1.98, 2.86), (-.24, .24, 2.02, 2.74)):
        yb, yt = front_y(z0, end) + .03 * sgn, front_y(z1, end) + .03 * sgn
        pts = [(x0, yb, z0), (x1, yb, z0), (x1, yt, z1), (x0, yt, z1)]
        pane(f'ws{end}{x0}', pts if end == 1 else list(reversed(pts)))
    # gaskets around the windscreens, following the rake
    for x0, x1, z0, z1 in ((-1.1, -.36, 1.98, 2.86), (.36, 1.1, 1.98, 2.86), (-.24, .24, 2.02, 2.74)):
        for zz in (z0, z1): box('wgz', (x1 - x0 + .04, .03, .03), ((x0 + x1) / 2, front_y(zz, end) + .005 * sgn, zz), 'rubber')
        for xx in (x0, x1):
            a, b = Vector((xx, front_y(z0, end) + .005 * sgn, z0)), Vector((xx, front_y(z1, end) + .005 * sgn, z1))
            tube('wgx', [tuple(a), tuple(b)], .016, 'rubber')
    for x in (-.95, .95): cyl('marker', .045, .04, (x, front_y(3.0, end) - .01 * sgn, 2.99), 'taillight', rot=(math.radians(90 - 9 * sgn), 0, 0), verts=16)
    # wipers
    for x in (-.72, .72):
        z = 2.02; y = front_y(z, end) - .02 * sgn
        tube(f'wiper{end}{x}', [(x - .02, y, z), (x + .28 * (1 if x < 0 else -1), front_y(2.5, end) - .02 * sgn, 2.5)], .008, 'rubber')

# ---------------------------------------------------------------- doors (inset panels with windows) and handrails
for s in (-1, 1):
    for d in DOORS:
        for half, (y0, y1) in enumerate(((d - DOOR_W / 2, d), (d, d + DOOR_W / 2))):
            bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
            bmesh.ops.scale(bm, vec=Vector((.04, y1 - y0 - .012, 2.84 - FLOOR - .02)), verts=bm.verts)
            ob = obj_from_bm(bm, 'door'); ob.location = (s * 1.3, (y0 + y1) / 2, (FLOOR + 2.84) / 2)
            add_mats(ob, ['paint_upper', 'paint_lower', 'paint_stripe', 'roof'])
            # door window
            c = box('dcut', (.2, y1 - y0 - .22, .72), (s * 1.3, (y0 + y1) / 2, 2.32), 'rubber')
            b = ob.modifiers.new('b', 'BOOLEAN'); b.operation = 'DIFFERENCE'; b.object = c; b.solver = 'EXACT'
            apply_mods(ob); bpy.data.objects.remove(c)
            select_only(ob); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
            livery(ob, roof=False)
            pane('dglass', [(s * 1.3, y0 + .11, 1.96), (s * 1.3, y1 - .11, 1.96), (s * 1.3, y1 - .11, 2.68), (s * 1.3, y0 + .11, 2.68)] if s > 0 else
                 [(s * 1.3, y1 - .11, 1.96), (s * 1.3, y0 + .11, 1.96), (s * 1.3, y0 + .11, 2.68), (s * 1.3, y1 - .11, 2.68)])
        box('dseam', (.05, .012, 1.7), (s * 1.325, d, 2.0), 'rubber')
        for yy in (d - DOOR_W / 2 - .09, d + DOOR_W / 2 + .09):  # grab rails beside the doorway
            tube('grab', [(s * 1.36, yy, 1.35), (s * 1.39, yy, 1.4), (s * 1.39, yy, 2.2), (s * 1.36, yy, 2.25)], .016, 'chrome')
        box('step', (.2, DOOR_W + .1, .06), (s * 1.3, d, FLOOR - .03), 'underframe')

# ---------------------------------------------------------------- body seams (thin dark lines), rain strip over the windows
for s_ in (-1, 1):
    for y in (1.0, 2.55, DOORS[0] + .95, 7.5, DOORS[1] - .95, L - 2.55, L - 1.0):
        box('seam', (.006, .01, 1.62), (s_ * 1.341, y, 1.95), 'rubber')
    box('rain', (.025, L - 1.6, .025), (s_ * 1.33, L / 2, 2.8), 'paint_upper')

# ---------------------------------------------------------------- interior
box('floor', (2.5, L - .5, .04), (0, L / 2, FLOOR + .1), 'floor')
for s in (-1, 1):
    segs = [(.9, DOORS[0] - DOOR_W / 2 - .15), (DOORS[0] + DOOR_W / 2 + .15, DOORS[1] - DOOR_W / 2 - .15), (DOORS[1] + DOOR_W / 2 + .15, L - .9)]
    for y0, y1 in segs:
        box('seat', (.48, y1 - y0, .14), (s * .98, (y0 + y1) / 2, FLOOR + .52), 'seat', bevel=.04)
        box('back', (.1, y1 - y0, .5), (s * 1.19, (y0 + y1) / 2, FLOOR + .85), 'seat', bevel=.035)
        box('seatbase', (.4, y1 - y0, .38), (s * 1.0, (y0 + y1) / 2, FLOOR + .3), 'underframe')
    tube('rail', [(s * .62, .9, 2.95), (s * .62, L - .9, 2.95)], .013, 'chrome')
for y in (DOORS[0] - .5, DOORS[0] + .5, DOORS[1] - .5, DOORS[1] + .5):
    tube('pole', [(0, y, FLOOR + .1), (0, y, 3.05)], .018, 'chrome')
for s in (-.5, .5): box('lamp', (.12, L - 1.4, .03), (s, L / 2, 3.1), 'ceiling_light')
for end, y in ((0, .75), (1, L - .75)):  # cab bulkheads with a little console
    box('bulk', (2.5, .04, 2.0), (0, y + (.25 if end == 0 else -.25), FLOOR + 1.0), 'cab')
    box('cabfloor', (2.4, 1.0, .04), (0, y - (.2 if end == 0 else -.2), FLOOR + .12), 'cab')
    box('console', (2.2, .45, .62), (0, y + (-.35 if end == 0 else .35), FLOOR + .45), 'cab', bevel=.04)
    box('dash', (.9, .3, .08), (-.55, y + (-.4 if end == 0 else .4), FLOOR + .8), 'underframe', rot=(math.radians(20 * (1 if end == 0 else -1)), 0, 0))
    box('cabseat', (.45, .45, .5), (-.55, y + (.05 if end == 0 else -.05), FLOOR + .45), 'seat', bevel=.05)

# ---------------------------------------------------------------- cab details (both ends)
for end in (0, 1):
    sgn = 1 if end == 0 else -1
    yf = front_y(1.5, end)
    rot = (math.radians(90), 0, 0)
    for x in (-.86, .86):
        cyl('hl_bezel', .135, .06, (x, yf - .02 * sgn, 1.52), 'chrome', rot=rot, verts=32, bevel=.012)
        cyl('hl_lens', .105, .03, (x, yf - .05 * sgn, 1.52), 'headlight' if end == 0 else 'taillight', rot=rot, verts=32)
        cyl('tl', .055, .04, (x + (.26 if x < 0 else -.26), yf - .03 * sgn, 1.52), 'taillight', rot=rot, verts=20)
    box('numplate', (.46, .02, .16), (0, yf - .015 * sgn, 1.52), 'chrome')
    pts = [(-.2, yf - .03 * sgn, 1.46), (.2, yf - .03 * sgn, 1.46), (.2, yf - .03 * sgn, 1.58), (-.2, yf - .03 * sgn, 1.58)]
    pane('num', pts if end == 1 else list(reversed(pts)), 'decal')
    # gangway door outline + handles
    for x in (-.3, .3): box('gw', (.008, .012, .8), (x, yf - .006 * sgn, 1.55), 'rubber')
    for x in (-.52, .52): tube('fh', [(x, yf - .03 * sgn, 1.25), (x, yf - .07 * sgn, 1.28), (x, yf - .07 * sgn, 1.68), (x, yf - .03 * sgn, 1.71)], .014, 'chrome')
    # destination board glow plane in its recess
    zd = 3.015; y = front_y(zd, end) + .05 * sgn
    pts = [(-.4, y, 2.945), (.4, y, 2.945), (.4, y + RAKE * .14 * sgn, 3.085), (-.4, y + RAKE * .14 * sgn, 3.085)]
    d = pane('dest', pts if end == 1 else list(reversed(pts)), 'dest')
    # skirt (snow plough): slim V plate with ribs
    ys = -.08 if end == 0 else L + .08
    for side in (-1, 1):
        bm = bmesh.new()
        pts = [(0, -.3, .36), (side * .92, -.04, .36), (side * .96, 0, .7), (0, -.2, .7)]
        v = [bm.verts.new((x, ys + dy * sgn, z)) for x, dy, z in pts]
        bm.faces.new(v if (side * sgn) < 0 else list(reversed(v)))
        sk = obj_from_bm(bm, 'skirt', 'skirt'); so = sk.modifiers.new('s', 'SOLIDIFY'); so.thickness = .02; apply_mods(sk)
        for rx in (.3, .62): box('rib', (.025, .1, .3), (side * rx, ys + (-.27 + rx * .26) * sgn, .53), 'underframe')
    box('coupler', (.16, .5, .14), (0, ys - .1 * sgn, .86), 'bogie', bevel=.03)
    box('couphead', (.26, .12, .22), (0, ys - .38 * sgn, .86), 'bogie', bevel=.03)
    for x in (-.2, .2): cyl('hose', .03, .35, (x, ys - .1 * sgn, .62), 'rubber', rot=(math.radians(30 * sgn), 0, 0), verts=10)

# ---------------------------------------------------------------- roof
def roof_z(x): return 3.3 - (abs(x) / .95) ** 2 * .2
for s in (-1, 1):
    tube('gutter', [(s * 1.3, .5, 2.88), (s * 1.3, L - .5, 2.88)], .018, 'roof')
    tube('conduit', [(s * .55, 1.0, roof_z(.55) + .04), (s * .55, L - 1.0, roof_z(.55) + .04)], .022, 'grille')
for yc in (4.2, L - 4.2):  # low-profile AC units
    box('ac', (1.4, 2.3, .2), (0, yc, 3.3 + .08), 'grille', bevel=.06, segs=3)
    for i in range(9): box('acfin', (1.2, .05, .02), (0, yc - 1.0 + i * .25, 3.3 + .19), 'bogie')
    cyl('acfan', .28, .03, (0, yc, 3.3 + .19), 'bogie', verts=24)
box('runboard', (.5, L - 9.2, .03), (0, L / 2, 3.31), 'bogie')
# folded single-arm pantograph over the rear bogie
py = L - 2.6
for s in (-1, 1): cyl('insulator', .045, .12, (s * .45, py - .4, 3.36), 'decal', verts=12)
box('pbase', (1.0, .9, .05), (0, py - .4, 3.43), 'bogie')
tube('parm', [(0, py - .7, 3.46), (0, py + .5, 3.56), (0, py - .2, 3.64)], .025, 'grille')
tube('phead', [(-.8, py - .2, 3.66), (.8, py - .2, 3.66)], .02, 'grille')
cyl('horn', .05, .22, (.5, .9, roof_z(.5) + .06), 'chrome', rot=(math.radians(90), 0, 0), verts=14, r2=.08)

# ---------------------------------------------------------------- underframe + bogies
box('sidesill', (2.5, L - 1.6, .12), (0, L / 2, FLOOR - .02), 'underframe')
for y, w, h, x in ((6.0, 1.4, .42, .35), (7.9, 1.1, .36, -.4), (9.4, .9, .45, .3), (5.2, .6, .3, -.5), (10.4, .8, .3, -.3)):
    box('equip', (1.3, w, h), (x, y, FLOOR - h / 2 - .05), 'underframe', bevel=.02)
for y in (6.9, 8.6): cyl('tank', .16, 1.1, (-.75, y, .82), 'underframe', rot=(math.radians(90), 0, 0), verts=20, bevel=.03)
for bc in (2.3, L - 2.3):
    for s in (-1, 1):
        # side frame: shallow fish-belly plate with cut-outs suggested by bevels
        bm = bmesh.new()
        pts = [(-1.35, .98), (1.35, .98), (1.25, .78), (.62, .74), (.35, .5), (-.35, .5), (-.62, .74), (-1.25, .78)]
        vs = [bm.verts.new((s * .9, bc + y, z)) for y, z in pts]; bm.faces.new(vs if s < 0 else list(reversed(vs)))
        fr = obj_from_bm(bm, 'sideframe', 'bogie'); so = fr.modifiers.new('s', 'SOLIDIFY'); so.thickness = .12; so.offset = 0
        bv = fr.modifiers.new('b', 'BEVEL'); bv.width = .02; bv.segments = 2; apply_mods(fr); smooth(fr)
        for a in (-1.05, 1.05):
            box('axlebox', (.2, .28, .24), (s * .9, bc + a, .65), 'bogie', bevel=.03)
            # coil spring above the axle box
            pts = [(s * .9 + .07 * math.cos(t), bc + a + .07 * math.sin(t), .78 + t / (math.pi * 2) * .045) for t in [i * .35 for i in range(int(6 * math.pi / .35))]]
            tube('spring', pts, .014, 'wheel', verts=6)
        box('brake', (.14, .22, .2), (s * .8, bc, .7), 'underframe', bevel=.02)
    box('bolster', (1.9, .35, .2), (0, bc, .92), 'bogie', bevel=.03)
    for a in (-1.05, 1.05):
        cyl('axle', .07, 1.6, (0, bc + a, .63), 'wheel', rot=(0, math.radians(90), 0), verts=12)
        for s in (-1, 1):
            cyl('wheel', .41, .12, (s * .72, bc + a, .63), 'wheel', rot=(0, math.radians(90), 0), verts=36, bevel=.015)
            cyl('flange', .44, .025, (s * .66, bc + a, .63), 'wheel', rot=(0, math.radians(90), 0), verts=36)
            cyl('hub', .14, .16, (s * .74, bc + a, .63), 'bogie', rot=(0, math.radians(90), 0), verts=18)

# ---------------------------------------------------------------- decals: line logo panels on both sides, car number
for s in (-1, 1):
    for y in (6.8,):
        y0, y1, z0, z1 = y - .9, y + .9, 1.42, 1.66
        pts = [(s * 1.342, y0, z0), (s * 1.342, y1, z0), (s * 1.342, y1, z1), (s * 1.342, y0, z1)]
        pane('logo', pts if s > 0 else [pts[1], pts[0], pts[3], pts[2]], 'decal')

# ---------------------------------------------------------------- join by material, export
parts = [o for o in col.objects if o.type == 'MESH']
with bpy.context.temp_override(active_object=shell, object=shell, selected_objects=parts, selected_editable_objects=parts):
    bpy.ops.object.join()
car = shell; car.name = 'MomijiCar'
select_only(car); bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
me = car.data
# UVs for the decal and destination planes: box-project everything, then fix the two emissive planes to 0..1
layer = me.uv_layers[0] if len(me.uv_layers) else me.uv_layers.new(name='UVMap')
uv = layer.data
for poly in me.polygons:
    mname = me.materials[poly.material_index].name
    if mname in ('dest', 'decal') and len(poly.loop_indices) == 4:
        u1 = .133 if mname == 'decal' and abs(poly.normal.y) > .5 else 1  # front plate shows only the leaf emblem
        u0 = 0 if u1 == 1 else -.07; u1 = u1 + (0 if u1 == 1 else .07)
        for k, li in enumerate(poly.loop_indices): uv[li].uv = [(u0, 0), (u1, 0), (u1, 1), (u0, 1)][k]
    else:
        n = poly.normal
        for li in poly.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv[li].uv = (co.y, co.z) if abs(n.x) > max(abs(n.y), abs(n.z)) else (co.x, co.z) if abs(n.y) > abs(n.z) else (co.x, co.y)
# Collapse to few draw calls: base colour (+ roughness in alpha) goes to a colour attribute, materials merge into
# groups. paint_lower stays its own material so the game can recolour the livery per variant.
GROUP = {'paint_upper': 'paint', 'paint_stripe': 'paint', 'roof': 'paint', 'paint_lower': 'paint_lower',
         'interior': 'dielectric', 'cab': 'dielectric', 'rubber': 'dielectric', 'underframe': 'dielectric', 'bogie': 'dielectric', 'seat': 'dielectric', 'floor': 'dielectric',
         'chrome': 'metal', 'wheel': 'metal', 'grille': 'metal',
         'skirt': 'dielectric', 'glass': 'glass', 'headlight': 'headlight', 'taillight': 'taillight', 'dest': 'dest', 'ceiling_light': 'ceiling_light', 'decal': 'decal'}
attr = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
lin2s = lambda x: x * 12.92 if x <= .0031308 else 1.055 * x ** (1 / 2.4) - .055
for poly in me.polygons:
    m = me.materials[poly.material_index]; pn = m.node_tree.nodes['Principled BSDF']
    c = pn.inputs['Base Color'].default_value; rgh = pn.inputs['Roughness'].default_value
    for li in poly.loop_indices: attr.data[li].color = (c[0], c[1], c[2], 1 - rgh)
groups = []
for m in me.materials: g = GROUP[m.name]; groups.append(g)
order = []
for g in groups:
    if g not in order: order.append(g)
newmats = []
for g in order:
    nm = bpy.data.materials.get(g + '_m') or bpy.data.materials.new(g)
    nm.name = g; newmats.append(nm)
remap = [order.index(g) for g in groups]
idx = [remap[p.material_index] for p in me.polygons]
me.materials.clear()
for nm in newmats: me.materials.append(nm)
for p, i in zip(me.polygons, idx): p.material_index = i
tris = sum(len(p.vertices) - 2 for p in me.polygons)
print(f'[train] objects joined, {len(me.vertices)} verts, ~{tris} tris, {len(me.materials)} materials')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True, export_texcoords=True, export_normals=True, export_vertex_color='ACTIVE', export_all_vertex_colors=False)
print('[train] wrote', OUT)

# ---------------------------------------------------------------- preview render
if '--render' in ARGS:
    out = ARGS[ARGS.index('--render') + 1]
    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    bg = world.node_tree.nodes['Background']; bg.inputs['Color'].default_value = (.9, .75, .55, 1); bg.inputs['Strength'].default_value = .8
    sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 4; sun.color = (1, .85, .65); so = bpy.data.objects.new('sun', sun); scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(55), 0, math.radians(-140))
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=40); g = obj_from_bm(bm, 'ground', 'floor')
    cam = bpy.data.cameras.new('cam'); cam.lens = 35; co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
    views = [((5.5, -6.5, 2.4), (0, 3.0, 1.9)), ((-4.6, 7.5, 5.2), (0, 7.5, 2.4)), ((1.8, -2.8, 1.1), (0, 0, 1.6)), ((2.6, 2.6, .9), (0, 2.3, .6))]
    scene.render.engine = 'BLENDER_EEVEE'; scene.render.resolution_x = 960; scene.render.resolution_y = 600
    scene.render.film_transparent = False
    for i, (p, t) in enumerate(views):
        co.location = p; d = Vector(t) - Vector(p); co.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = out.replace('.png', f'-{i}.png'); bpy.ops.render.render(write_still=True)
    print('[train] rendered')
