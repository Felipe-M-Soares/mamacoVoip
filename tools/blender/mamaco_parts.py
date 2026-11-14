# Modela as peças do mamaco no Blender e exporta como geometria compacta (JSON).
# Coordenadas = as do three.js (x direita, y cima, z frente), em cada quadro local.
import bpy, bmesh, math, json, base64, struct, sys
from mathutils import Vector, Matrix

def clear():
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
    for m in list(bpy.data.meshes): bpy.data.meshes.remove(m)

def ell(name, c, r, seg=48, rings=32, rot=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=c)
    o = bpy.context.active_object; o.name = name; o.scale = r
    if rot: o.rotation_euler = rot
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o

def cap(name, a, b, r, seg=32):
    a = Vector(a); b = Vector(b); d = b - a; L = d.length
    bpy.ops.mesh.primitive_cylinder_add(vertices=seg, radius=r, depth=L, location=(a + b) / 2)
    o = bpy.context.active_object; o.name = name
    o.rotation_euler = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    e1 = ell(name + 'a', tuple(a), (r, r, r), 24, 16); e2 = ell(name + 'b', tuple(b), (r, r, r), 24, 16)
    return [o, e1, e2]

def cone(name, base, tip, r, seg=32):
    base = Vector(base); tip = Vector(tip); d = tip - base
    bpy.ops.mesh.primitive_cone_add(vertices=seg, radius1=r, radius2=0, depth=d.length, location=(base + tip) / 2)
    o = bpy.context.active_object; o.name = name
    o.rotation_euler = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_euler()
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.active_object; o.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    return o

def modapply(o, typ, **kw):
    m = o.modifiers.new('m', typ)
    for k, v in kw.items(): setattr(m, k, v)
    bpy.context.view_layer.objects.active = o
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.modifier_apply(modifier=m.name)

def boolean(o, cutter, op='DIFFERENCE'):
    m = o.modifiers.new('b', 'BOOLEAN'); m.operation = op; m.object = cutter; m.solver = 'EXACT'
    with bpy.context.temp_override(object=o, active_object=o, selected_objects=[o]):
        bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

def fuse(objs, name, voxel, smooth_it=6, faces=3000, smooth_f=0.5):
    o = join(objs, name) if len(objs) > 1 else objs[0]
    modapply(o, 'REMESH', mode='VOXEL', voxel_size=voxel, adaptivity=0.0)
    if smooth_it: modapply(o, 'SMOOTH', factor=smooth_f, iterations=smooth_it)
    n = len(o.data.polygons)
    if n > faces: modapply(o, 'DECIMATE', ratio=faces / n)
    return o

# SDF de elipsoide (aproximado) pra separar regiões de cor
def sdf_ell(p, c, r):
    q = Vector(((p.x - c[0]) / r[0], (p.y - c[1]) / r[1], (p.z - c[2]) / r[2]))
    return (q.length - 1) * min(r)

def zones(o, rule):
    # rule(p, n) -> índice da zona
    me = o.data
    for poly in me.polygons:
        poly.material_index = rule(o.matrix_world @ poly.center, poly.normal)
    # suaviza a fronteira: zona por maioria dos vizinhos (2 passadas)
    bm = bmesh.new(); bm.from_mesh(me)
    for _ in range(2):
        new = {}
        for f in bm.faces:
            cnt = {}
            for e in f.edges:
                for g in e.link_faces:
                    cnt[g.material_index] = cnt.get(g.material_index, 0) + 1
            best = max(cnt.items(), key=lambda kv: kv[1])[0]
            if cnt.get(f.material_index, 0) < 3: new[f.index] = best
        for f in bm.faces:
            if f.index in new: f.material_index = new[f.index]
    bm.to_mesh(me); bm.free()

OUT = {}
def export(o, key, zone_names):
    bpy.context.view_layer.objects.active = o
    me = o.data
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    me.shade_smooth() if hasattr(me, 'shade_smooth') else None
    for p in me.polygons: p.use_smooth = True
    # vértices por (vert) com normal suave; agrupa triângulos por zona
    verts = me.vertices
    for v in verts: pass
    tri_by_zone = {}
    for p in me.polygons:
        tri_by_zone.setdefault(p.material_index, []).append([me.loops[li].vertex_index for li in p.loop_indices])
    pos = [v.co for v in verts]; nor = [v.normal for v in verts]
    mx = max(max(abs(c) for c in v) for v in pos) or 1
    sc = mx / 32767.0
    pb = b''.join(struct.pack('<3h', *[int(round(c / sc)) for c in v]) for v in pos)
    nb = b''.join(struct.pack('<3b', *[int(round(max(-1, min(1, c)) * 127)) for c in n]) for n in nor)
    idx = []; groups = []
    for z in sorted(tri_by_zone):
        start = len(idx)
        for t in tri_by_zone[z]: idx += t
        groups.append([start, len(idx) - start, zone_names[z] if z < len(zone_names) else zone_names[0]])
    ib = struct.pack('<%dH' % len(idx), *idx)
    OUT[key] = {'s': sc, 'p': base64.b64encode(pb).decode(), 'n': base64.b64encode(nb).decode(), 'i': base64.b64encode(ib).decode(), 'g': groups}
    print(key, len(pos), 'verts', len(idx) // 3, 'tris', groups and [g[2] for g in groups])

def build():
    clear()
    # ---------- CABEÇA (quadro da cabeça, antes do ×1.22) ----------
    skull = ell('skull', (0, 0.31, 0), (0.3885, 0.359, 0.37), 64, 48)
    # rosto em "coração": dois lóbulos (olhos) + focinho largo, pouco salientes
    lobL = ell('lobL', (-0.098, 0.35, 0.245), (0.16, 0.18, 0.125), 48, 32)
    lobR = ell('lobR', (0.098, 0.35, 0.245), (0.16, 0.18, 0.125), 48, 32)
    muz = ell('muz', (0, 0.205, 0.255), (0.255, 0.165, 0.145), 48, 32)
    head = fuse([skull, lobL, lobR, muz], 'head', 0.005, 10, 1900, 0.45)
    def head_rule(p, n):
        if p.z < 0.16 or n.z < 0.05: return 0
        e = lambda cx, cy, rx, ry: ((p.x - cx) / rx) ** 2 + ((p.y - cy) / ry) ** 2 < 1
        return 1 if (e(-0.098, 0.35, 0.152, 0.172) or e(0.098, 0.35, 0.152, 0.172) or e(0, 0.205, 0.245, 0.158)) else 0
    zones(head, head_rule)
    export(head, 'head', ['skull', 'face'])

    # ---------- ORELHA (quadro da orelha, lado +x; o código espelha) ----------
    clear()
    outer = ell('ear', (0, 0, 0), (0.06, 0.135, 0.128))
    cut = ell('cut', (0.065, 0.01, 0.01), (0.05, 0.098, 0.092))
    boolean(outer, cut)
    ear = fuse([outer], 'ear', 0.004, 4, 300)
    zones(ear, lambda p, n: 1 if (p.x > 0.008 and n.x > 0.2 and abs(p.y) < 0.11 and abs(p.z) < 0.105) else 0)
    export(ear, 'ear', ['ear', 'earIn'])

    # ---------- CORPO (quadro do bodyG) ----------
    clear()
    torso = ell('torso', (0, 0, 0), (0.33, 0.37, 0.345))
    belly = ell('belly', (0, -0.05, 0.255), (0.205, 0.25, 0.115))
    hipL = ell('hipL', (-0.13, -0.24, -0.02), (0.15, 0.13, 0.17)); hipR = ell('hipR', (0.13, -0.24, -0.02), (0.15, 0.13, 0.17))
    body = fuse([torso, belly, hipL, hipR], 'body', 0.007, 5, 950)
    zones(body, lambda p, n: 1 if (sdf_ell(p, (0, -0.05, 0.255), (0.205, 0.25, 0.115)) < sdf_ell(p, (0, 0, 0), (0.33, 0.37, 0.345)) - 0.002 and p.z > 0.15) else 0)
    export(body, 'body', ['body', 'belly'])

    # ---------- MÃO (quadro da mão; dedos pra baixo, polegar pra frente) ----------
    clear()
    palm = ell('palm', (0, 0, 0), (0.088, 0.088, 0.07))
    parts = [palm]
    for i, x in enumerate((-0.047, 0, 0.047)):
        parts += cap('f%d' % i, (x * 0.8, -0.03, 0.005), (x, -0.085 - (0.008 if i == 1 else 0), 0.01), 0.032, 20)
    parts += cap('th', (-0.03, -0.0, 0.03), (-0.055, -0.025, 0.075), 0.033, 20)
    hand = fuse(parts, 'hand', 0.0035, 4, 330)
    export(hand, 'hand', ['hand'])

    # ---------- PÉ (quadro do tornozelo) ----------
    clear()
    sole = ell('sole', (0, -0.025, 0.05), (0.118, 0.06, 0.145))
    heel = ell('heel', (0, -0.02, -0.03), (0.09, 0.055, 0.08))
    parts = [sole, heel]
    for x in (-0.052, 0, 0.052):
        parts.append(ell('t', (x, -0.038, 0.168), (0.038, 0.034, 0.042)))
    foot = fuse(parts, 'foot', 0.0035, 4, 320)
    export(foot, 'foot', ['foot'])

    # ---------- CAPUZ (quadro da cabeça) com espessura e borda redonda ----------
    clear()
    shell = ell('hood', (0, 0.31, 0), (0.437, 0.405, 0.421), 64, 40)
    inner = ell('hin', (0, 0.31, 0), (0.405, 0.373, 0.389), 64, 40)
    boolean(shell, inner)
    hole = ell('hole', (0, 0.255, 0.42), (0.3, 0.33, 0.22))
    boolean(shell, hole)
    hood = fuse([shell], 'hood', 0.0045, 6, 1400, 0.6)
    export(hood, 'hood', ['hood'])

    # ---------- CHAPÉU DE PIRATA (tricórnio) ----------
    clear()
    crown = ell('crown', (0, 0.5, -0.01), (0.33, 0.17, 0.32))
    bpy.ops.mesh.primitive_cylinder_add(vertices=3, radius=0.62, depth=0.05, location=(0, 0, 0))
    brim = bpy.context.active_object; brim.rotation_euler = (0, 0, -math.pi / 2)
    bpy.ops.object.transform_apply(location=True, rotation=True)
    # bordas do tricórnio dobradas pra cima (aqui z = cima)
    bm = bmesh.new(); bm.from_mesh(brim.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=6, use_grid_fill=True)
    for v in bm.verts:
        rr = math.hypot(v.co.x, v.co.y)
        v.co.z += max(0, rr - 0.3) ** 1.6 * 0.9
    bm.to_mesh(brim.data); bm.free()
    brim.rotation_euler = (-math.pi / 2, 0, 0); brim.location = (0, 0.47, -0.01)
    bpy.ops.object.transform_apply(location=True, rotation=True)
    cut = ell('c', (0, 0.3, 0), (0.37, 0.2, 0.36))
    boolean(brim, cut)
    tri = fuse([crown, brim], 'tricorn', 0.006, 3, 900, 0.4)
    export(tri, 'tricorn', ['hat', 'trim'])

    # ---------- CHAPÉU DE MAGO (cone dobrado + aba) ----------
    clear()
    bpy.ops.mesh.primitive_cone_add(vertices=40, radius1=0.33, radius2=0.012, depth=0.72, location=(0, 0, 0), end_fill_type='NGON')
    c = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(c.data)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.1], cuts=10)
    for v in bm.verts:
        h = (v.co.z + 0.36) / 0.72  # 0 na base, 1 na ponta (cone feito em z, gira depois)
        v.co.x -= (max(0, h - 0.45) ** 2) * 0.55
    bm.to_mesh(c.data); bm.free()
    c.rotation_euler = (-math.pi / 2, 0, 0); c.location = (0, 0.88, -0.02)
    bpy.ops.object.transform_apply(location=True, rotation=True)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.6, depth=0.04, location=(0, 0, 0))
    brim = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(brim.data)
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=3, use_grid_fill=True)
    for v in bm.verts:
        rr = math.hypot(v.co.x, v.co.y)
        v.co.z -= max(0, rr - 0.42) * 0.25 * (1 + 0.6 * math.sin(math.atan2(v.co.y, v.co.x) * 3))
    bm.to_mesh(brim.data); bm.free()
    brim.rotation_euler = (-math.pi / 2, 0, 0); brim.location = (0, 0.53, 0)
    bpy.ops.object.transform_apply(location=True, rotation=True)
    wiz = fuse([c, brim], 'wizard', 0.006, 3, 900, 0.4)
    export(wiz, 'wizard', ['hat'])

    # ---------- ORELHA DE COELHO (quadro da cabeça, lado +x) ----------
    clear()
    e = ell('be', (0.14, 0.86, -0.04), (0.07, 0.24, 0.045), rot=(0, 0, -0.18))
    cut = ell('bc', (0.14 - 0.0, 0.88, 0.005), (0.042, 0.19, 0.03), rot=(0, 0, -0.18))
    boolean(e, cut)
    be = fuse([e], 'bunny', 0.004, 4, 380)
    zones(be, lambda p, n: 1 if (n.z > 0.35 and p.z > -0.03) else 0)
    export(be, 'bunnyEar', ['fur', 'inner'])

    # ---------- ORELHA REDONDA (tigre) ----------
    clear()
    e = ell('te', (0, 0, 0), (0.1, 0.1, 0.055))
    cut = ell('tc', (0, -0.005, 0.045), (0.065, 0.065, 0.035))
    boolean(e, cut)
    te = fuse([e], 'tiger', 0.004, 4, 260)
    zones(te, lambda p, n: 1 if (n.z > 0.3 and p.z > 0.0 and math.hypot(p.x, p.y) < 0.07) else 0)
    export(te, 'roundEar', ['fur', 'inner'])

    # ---------- CHIFRE DE UNICÓRNIO (espiral) ----------
    clear()
    bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=0.06, radius2=0.004, depth=0.28, location=(0, 0.14, 0))
    h = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(h.data)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.05], cuts=16)
    for v in bm.verts:
        t = (v.co.z + 0.14) / 0.28
        a = math.atan2(v.co.y, v.co.x)
        r = math.hypot(v.co.x, v.co.y)
        r *= 1 + 0.18 * math.sin(a * 2 + t * 24)
        v.co.x = math.cos(a) * r; v.co.y = math.sin(a) * r
    bm.to_mesh(h.data); bm.free()
    h.rotation_euler = (-math.pi / 2, 0, 0); bpy.ops.object.transform_apply(location=True, rotation=True)
    horn = fuse([h], 'horn', 0.003, 2, 500, 0.3)
    export(horn, 'horn', ['horn'])

    # ---------- ESPINHO DE DINO (barbatana curva) ----------
    clear()
    sp = ell('sp', (0, 0.045, 0), (0.025, 0.07, 0.06))
    tip = cone('tp', (0, 0.06, -0.005), (0, 0.13, -0.04), 0.04)
    spike = fuse([sp, tip], 'spike', 0.003, 3, 140)
    export(spike, 'spike', ['spike'])

    # ---------- CAPA (com dobras) — quadro do torso ----------
    clear()
    bpy.ops.mesh.primitive_cylinder_add(vertices=40, radius=1, depth=0.78, location=(0, 0, 0), end_fill_type='NOTHING')
    cp = bpy.context.active_object
    bm = bmesh.new(); bm.from_mesh(cp.data)
    bmesh.ops.subdivide_edges(bm, edges=[e for e in bm.edges if abs(e.verts[0].co.z - e.verts[1].co.z) > 0.1], cuts=8)
    keep = []
    for v in bm.verts:
        a = math.atan2(v.co.y, v.co.x)
        t = (0.39 - v.co.z) / 0.78  # 0 em cima, 1 embaixo
        r = 0.27 + 0.16 * t + 0.02 * math.sin(a * 9) * t
        v.co.x = math.cos(a) * r; v.co.y = math.sin(a) * r
    # só a metade de trás (y < 0 aqui, que vira -z)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.y < -0.04], context='VERTS')
    bm.to_mesh(cp.data); bm.free()
    cp.rotation_euler = (-math.pi / 2, 0, 0); bpy.ops.object.transform_apply(rotation=True)
    cp.location = (0, 0.12, -0.04); bpy.ops.object.transform_apply(location=True)
    modapply(cp, 'SOLIDIFY', thickness=0.018)
    export(cp, 'cape', ['cape'])

    # ---------- BANANA: topo + cascas ----------
    clear()
    t1 = cone('bt', (0, 0.62, -0.03), (0, 0.98, -0.1), 0.24, 40)
    st = cap('stem', (0, 0.96, -0.09), (0, 1.07, -0.12), 0.035, 16)
    bt = fuse([t1] + st, 'btop', 0.005, 4, 450)
    zones(bt, lambda p, n: 1 if p.y > 0.97 else 0)
    export(bt, 'bananaTop', ['peel', 'stem'])
    clear()
    pe = ell('pe', (0, 0, 0), (0.12, 0.2, 0.04))
    bm = bmesh.new(); bm.from_mesh(pe.data)
    for v in bm.verts: v.co.z += (0.2 - v.co.y) ** 2 * 0.9  # abre pra fora embaixo
    bm.to_mesh(pe.data); bm.free()
    peel = fuse([pe], 'peel', 0.004, 3, 220)
    export(peel, 'peel', ['peel'])

build()
open(sys.argv[-1], 'w').write(json.dumps(OUT))
