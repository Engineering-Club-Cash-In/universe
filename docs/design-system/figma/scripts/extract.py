#!/usr/bin/env python3
"""Convierte los JSON de raw/ (REST API de Figma) en fichas legibles por componente.

Salida en docs/design-system/figma/:
  components/<página>.md   una ficha por componente (props, variantes y árbol con estilos)
  index.json               catálogo: componente -> página, sección, id, variantes, props

Formato del árbol (una línea por nodo):
  TIPO "nombre" WxH  row|col  w:fill h:hug  p:12,16  gap:8  justify:center items:center
       r:radius/md(14)  bg:brand/primary(#1fa79b)  bd:border/default(#d9d6d1) 1in
       fx:Shadow/Clay-Subtle/Light  text:"Botón" label/base 500 14/20 c:text/primary
Los colores ligados a variables muestran el token y el hex; sin variable, solo el hex.
Uso: python3 docs/design-system/figma/scripts/extract.py
"""
import json
import os
import re
from collections import OrderedDict

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.path.join(ROOT, "raw")
OUT = os.path.join(ROOT, "components")

VARS = json.load(open(os.path.join(ROOT, "variable-ids.json")))

PAGES = OrderedDict([
    ("59-877", "02-componentes"),
    ("84-877", "03-componentes-crm"),
    ("139-2020", "04-patrones"),
    ("199-877", "05-product-architecture"),
    ("57-877", "01-fundamentos"),
    ("271-877", "rol-asesor-junior"),
    ("1644-79", "rol-asesor-senior"),
    ("3785-7793", "rol-asesor-especial"),
    ("1954-12", "rol-supervisor"),
    ("3879-12", "rol-gerencia"),
    ("1529-115", "comprobantes-cobranza"),
    ("2226-12", "b3-modelo-estados"),
])


def var_name(alias):
    if not alias:
        return None
    vid = alias.get("id", "")
    name = VARS.get(vid)
    if name:
        return name.split("::", 1)[1]
    return "ext:" + vid.split("/")[-1]


def hexcolor(c, opacity=1.0):
    a = c.get("a", 1) * (opacity if opacity is not None else 1)
    h = "#%02x%02x%02x" % (round(c["r"] * 255), round(c["g"] * 255), round(c["b"] * 255))
    if a < 0.999:
        h += "%02x" % round(a * 255)
    return h


def fmt_num(v):
    if v is None:
        return None
    v = round(v, 2)
    return str(int(v)) if v == int(v) else str(v)


def paint_str(p, bound=None):
    if p.get("visible") is False:
        return None
    t = p.get("type")
    if t == "SOLID":
        hx = hexcolor(p["color"], p.get("opacity", 1))
        vn = var_name((p.get("boundVariables") or {}).get("color")) or var_name(bound)
        return f"{vn}({hx})" if vn else hx
    if t and t.startswith("GRADIENT"):
        stops = ",".join(hexcolor(s["color"]) for s in p.get("gradientStops", []))
        return f"{t.lower()}[{stops}]"
    if t == "IMAGE":
        return "image"
    return t


class Ctx:
    def __init__(self, data):
        self.components = data.get("components", {})
        self.sets = data.get("componentSets", {})
        self.styles = data.get("styles", {})

    def style_name(self, node, kind):
        sid = (node.get("styles") or {}).get(kind)
        if sid and sid in self.styles:
            return self.styles[sid]["name"]
        return None

    def comp_label(self, cid):
        c = self.components.get(cid)
        if not c:
            return cid
        sid = c.get("componentSetId")
        if sid and sid in self.sets:
            return f"{self.sets[sid]['name']} / {c['name']}"
        return c["name"]


def node_line(n, ctx):
    t = n["type"]
    bb = n.get("absoluteBoundingBox") or {}
    parts = [t, json.dumps(n.get("name", ""), ensure_ascii=False)]
    if bb.get("width") is not None:
        parts.append(f"{fmt_num(bb['width'])}x{fmt_num(bb['height'])}")
    bv = n.get("boundVariables") or {}

    lm = n.get("layoutMode")
    if lm in ("HORIZONTAL", "VERTICAL"):
        parts.append("row" if lm == "HORIZONTAL" else "col")
        if n.get("layoutWrap") == "WRAP":
            parts.append("wrap")
    sh, sv = n.get("layoutSizingHorizontal"), n.get("layoutSizingVertical")
    if sh or sv:
        parts.append(f"w:{(sh or '-').lower()} h:{(sv or '-').lower()}")
    if n.get("layoutPositioning") == "ABSOLUTE":
        parts.append("absolute")
    if lm in ("HORIZONTAL", "VERTICAL"):
        pads = [n.get("paddingTop", 0), n.get("paddingRight", 0), n.get("paddingBottom", 0), n.get("paddingLeft", 0)]
        if any(pads):
            pv = [var_name(bv.get(k)) for k in ("paddingTop", "paddingRight", "paddingBottom", "paddingLeft")]
            ps = [f"{fmt_num(p)}" + (f"[{v}]" if v else "") for p, v in zip(pads, pv)]
            if len(set(ps)) == 1:
                ps = ps[:1]
            elif ps[0] == ps[2] and ps[1] == ps[3]:
                ps = ps[:2]
            parts.append("p:" + ",".join(ps))
        gap = n.get("itemSpacing")
        if gap:
            gv = var_name(bv.get("itemSpacing"))
            parts.append(f"gap:{fmt_num(gap)}" + (f"[{gv}]" if gv else ""))
        if n.get("primaryAxisAlignItems") not in (None, "MIN"):
            parts.append("justify:" + n["primaryAxisAlignItems"].lower())
        if n.get("counterAxisAlignItems") not in (None, "MIN"):
            parts.append("items:" + n["counterAxisAlignItems"].lower())

    if n.get("rectangleCornerRadii"):
        rr = n["rectangleCornerRadii"]
        if len(set(rr)) == 1:
            if rr[0]:
                parts.append(f"r:{fmt_num(rr[0])}")
        else:
            parts.append("r:" + ",".join(fmt_num(x) for x in rr))
    elif n.get("cornerRadius"):
        rv = (var_name((bv.get("rectangleCornerRadii") or {}).get("RECTANGLE_TOP_LEFT_CORNER_RADIUS"))
              or var_name(bv.get("topLeftRadius")) or var_name(bv.get("cornerRadius")))
        parts.append(f"r:{rv}({fmt_num(n['cornerRadius'])})" if rv else f"r:{fmt_num(n['cornerRadius'])}")

    fills = n.get("fills") or []
    fb = bv.get("fills") or []
    fs = [paint_str(p, fb[i] if i < len(fb) else None) for i, p in enumerate(fills)]
    fs = [f for f in fs if f]
    fill_style = ctx.style_name(n, "fill")
    if fs and t != "TEXT":
        parts.append("bg:" + "+".join(fs) + (f"{{{fill_style}}}" if fill_style else ""))

    strokes = n.get("strokes") or []
    sb = bv.get("strokes") or []
    ss = [paint_str(p, sb[i] if i < len(sb) else None) for i, p in enumerate(strokes)]
    ss = [s for s in ss if s]
    if ss:
        w = n.get("strokeWeight")
        ind = n.get("individualStrokeWeights")
        if ind:
            w = ",".join(fmt_num(ind[k]) for k in ("top", "right", "bottom", "left"))
        else:
            w = fmt_num(w)
        al = {"INSIDE": "in", "OUTSIDE": "out", "CENTER": "center"}.get(n.get("strokeAlign"), "")
        dash = " dashed" if n.get("strokeDashes") else ""
        parts.append(f"bd:{'+'.join(ss)} {w}{al}{dash}")

    effs = [e for e in (n.get("effects") or []) if e.get("visible", True)]
    if effs:
        en = ctx.style_name(n, "effect")
        if en:
            parts.append("fx:" + en)
        else:
            ed = []
            for e in effs:
                if e["type"] in ("DROP_SHADOW", "INNER_SHADOW"):
                    o = e.get("offset", {})
                    ed.append(f"{'inset ' if e['type'] == 'INNER_SHADOW' else ''}{fmt_num(o.get('x', 0))},{fmt_num(o.get('y', 0))} {fmt_num(e.get('radius', 0))} {fmt_num(e.get('spread', 0) or 0)} {hexcolor(e['color'])}")
                else:
                    ed.append(f"{e['type'].lower()} {fmt_num(e.get('radius', 0))}")
            parts.append("fx:[" + " | ".join(ed) + "]")

    if n.get("opacity") is not None and n["opacity"] < 0.999:
        ov = var_name(bv.get("opacity"))
        # Ojo: Figma guarda variables de opacidad en %, así que opacity/disabled=0.4 queda en 0.004.
        parts.append(f"opacity:{round(n['opacity'], 3)}" + (f"[{ov}]" if ov else ""))
    if n.get("clipsContent") and t in ("FRAME", "COMPONENT"):
        parts.append("clip")

    if t == "TEXT":
        st = n.get("style") or {}
        chars = n.get("characters", "").replace("\n", "⏎")
        if len(chars) > 80:
            chars = chars[:77] + "…"
        tsn = ctx.style_name(n, "text")
        lh = st.get("lineHeightPx")
        font = f"{st.get('fontFamily', '?')} {st.get('fontWeight', '')} {fmt_num(st.get('fontSize'))}/{fmt_num(lh)}"
        if st.get("letterSpacing"):
            font += f" ls{fmt_num(st['letterSpacing'])}"
        if st.get("textCase") and st["textCase"] != "ORIGINAL":
            font += " " + st["textCase"].lower()
        if st.get("textDecoration") and st["textDecoration"] != "NONE":
            font += " " + st["textDecoration"].lower()
        if st.get("textAlignHorizontal") not in (None, "LEFT"):
            font += " align-" + st["textAlignHorizontal"].lower()
        parts.append(f"text:{json.dumps(chars, ensure_ascii=False)} " + (f"{tsn} " if tsn else "") + font + (f" c:{'+'.join(fs)}" if fs else ""))

    if t == "INSTANCE":
        parts.insert(2, "→ " + json.dumps(ctx.comp_label(n.get("componentId", "")), ensure_ascii=False))
        props = n.get("componentProperties") or {}
        pv = []
        for k, v in props.items():
            if v.get("type") == "VARIANT":
                continue
            kk = k.split("#")[0]
            val = v.get("value")
            if v.get("type") == "INSTANCE_SWAP":
                val = ctx.comp_label(val)
            pv.append(f"{kk}={val}")
        if pv:
            parts.append("props{" + "; ".join(pv) + "}")
    if n.get("visible") is False:
        parts.append("(oculto)")
    return "  ".join(str(p) for p in parts if p)


def instance_texts(n, acc, limit=6):
    for c in n.get("children", []):
        if len(acc) >= limit:
            return
        if c.get("visible") is False:
            continue
        if c["type"] == "TEXT" and c.get("characters", "").strip():
            acc.append(c["characters"].strip().replace("\n", " ")[:50])
        else:
            instance_texts(c, acc, limit)


def tree(n, ctx, depth, lines, max_depth=14):
    lines.append("  " * depth + node_line(n, ctx))
    if n.get("visible") is False or depth >= max_depth:
        return
    if n["type"] == "INSTANCE":
        acc = []
        instance_texts(n, acc)
        if acc:
            lines.append("  " * (depth + 1) + "· textos: " + " | ".join(json.dumps(a, ensure_ascii=False) for a in acc))
        return
    if n["type"] in ("VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "REGULAR_POLYGON"):
        return
    for c in n.get("children", []):
        tree(c, ctx, depth + 1, lines, max_depth)


def prop_defs(cs):
    out = []
    for k, d in (cs.get("componentPropertyDefinitions") or {}).items():
        name = k.split("#")[0]
        if d["type"] == "VARIANT":
            out.append(f"- **{name}** (variante): {' · '.join(d.get('variantOptions', []))} — default `{d.get('defaultValue')}`")
        else:
            out.append(f"- **{name}** ({d['type'].lower()}): default `{d.get('defaultValue')}`")
    return out


def collect(n, path, found, notes):
    t = n["type"]
    if t == "COMPONENT_SET" or t == "COMPONENT":
        found.append((path, n))
        return
    if t == "TEXT":
        txt = (n.get("characters") or "").strip()
        if txt and n.get("visible") is not False:
            notes.setdefault(tuple(path[:2]), []).append(txt.replace("\n", " ⏎ "))
        return
    if t == "INSTANCE":
        return
    for c in n.get("children", []):
        collect(c, path + [c.get("name", "")] if t in ("CANVAS", "SECTION") or len(path) < 2 else path, found, notes)


def slug(s):
    s = re.sub(r"[^\w\s-]", "", s.lower(), flags=re.U)
    return re.sub(r"[\s_]+", "-", s).strip("-")


def main():
    os.makedirs(OUT, exist_ok=True)
    index = []
    for pid, pslug in PAGES.items():
        path = os.path.join(RAW, f"page-{pid}.json")
        if not os.path.exists(path):
            continue
        data = json.load(open(path))
        node = list(data["nodes"].values())[0]
        ctx = Ctx(node)
        doc = node["document"]
        found, notes = [], {}
        for c in doc.get("children", []):
            collect(c, [c.get("name", "")], found, notes)

        groups = OrderedDict()
        for p, n in found:
            groups.setdefault(tuple(p[:2]), []).append(n)

        md = [f"# {doc['name']}  (`{doc['id']}`)", "",
              "> Generado por `scripts/extract.py` desde la REST API de Figma. No editar a mano.", ""]
        if not found:
            md.append("_Esta página no tiene componentes maestros; ver notas por sección._\n")
        all_keys = list(groups.keys()) + [k for k in notes.keys() if k not in groups]
        for key in all_keys:
            md.append(f"## {' › '.join(k for k in key if k)}")
            md.append("")
            sec_notes = list(OrderedDict.fromkeys(notes.get(key, [])))
            if sec_notes:
                md.append("<details><summary>Textos de documentación de la sección</summary>\n")
                for s in sec_notes[:120]:
                    md.append(f"- {s[:300]}")
                md.append("\n</details>\n")
            for n in groups.get(key, []):
                desc = ""
                if n["type"] == "COMPONENT_SET":
                    desc = (ctx.sets.get(n["id"]) or {}).get("description", "")
                else:
                    desc = (ctx.components.get(n["id"]) or {}).get("description", "")
                variants = [c for c in n.get("children", []) if c["type"] == "COMPONENT"] if n["type"] == "COMPONENT_SET" else [n]
                md.append(f"### {n['name']}  `{n['id']}` — {n['type'].lower()}, {len(variants)} variante(s)")
                if desc:
                    md.append(f"\n> {desc.strip()}\n")
                pd = prop_defs(n) if n["type"] == "COMPONENT_SET" or n.get("componentPropertyDefinitions") else []
                if pd:
                    md.append("")
                    md.extend(pd)
                md.append("")
                for v in variants:
                    lines = []
                    tree(v, ctx, 0, lines)
                    if n["type"] == "COMPONENT_SET":
                        md.append(f"#### {v['name']}")
                    md.append("```")
                    md.extend(lines)
                    md.append("```")
                index.append({
                    "page": doc["name"], "pageFile": f"components/{pslug}.md", "section": " › ".join(k for k in key if k),
                    "name": n["name"], "id": n["id"], "type": n["type"], "variants": len(variants),
                    "props": {k.split("#")[0]: (d.get("variantOptions") or d["type"].lower()) for k, d in (n.get("componentPropertyDefinitions") or {}).items()},
                })
            md.append("")
        with open(os.path.join(OUT, f"{pslug}.md"), "w") as f:
            f.write("\n".join(md))
        print(f"{pslug}: {len(found)} componentes, {sum(len(g) for g in groups.values())} agrupados, {len(notes)} secciones con notas")
    with open(os.path.join(ROOT, "index.json"), "w") as f:
        json.dump(index, f, ensure_ascii=False, indent=1)
    print("index.json:", len(index), "componentes")


if __name__ == "__main__":
    main()
