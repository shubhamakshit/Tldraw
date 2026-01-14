#!/usr/bin/env python3
"""Compare original SVG with roundtrip SVG"""

import re
from xml.etree import ElementTree as ET
from collections import defaultdict

def parse_svg(path):
    """Parse SVG and extract element details"""
    with open(path, 'r') as f:
        content = f.read()

    # Parse XML
    try:
        root = ET.fromstring(content)
    except:
        # Fallback to regex if XML parsing fails
        return parse_svg_regex(content)

    ns = {'svg': 'http://www.w3.org/2000/svg', 'xlink': 'http://www.w3.org/1999/xlink'}

    elements = defaultdict(list)

    def process_elem(elem, depth=0):
        tag = elem.tag.split('}')[-1]  # Remove namespace
        attrs = dict(elem.attrib)

        if tag in ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'image', 'text']:
            info = {'tag': tag, 'depth': depth}

            # Key attributes
            for attr in ['fill', 'stroke', 'stroke-width', 'stroke-dasharray',
                        'fill-opacity', 'stroke-opacity', 'opacity', 'transform']:
                if attr in attrs:
                    info[attr] = attrs[attr][:30] if len(attrs.get(attr, '')) > 30 else attrs.get(attr)

            # Special handling
            if 'd' in attrs:
                info['d_len'] = len(attrs['d'])
                info['d_cmds'] = len(re.findall(r'[MLHVCSQTAZ]', attrs['d'], re.I))
            if 'points' in attrs:
                info['points_count'] = len(attrs['points'].split())
            if '{http://www.w3.org/1999/xlink}href' in attrs:
                href = attrs['{http://www.w3.org/1999/xlink}href']
                info['href'] = href[:40] + '...' if len(href) > 40 else href
            if 'href' in attrs:
                href = attrs['href']
                info['href'] = href[:40] + '...' if len(href) > 40 else href

            elements[tag].append(info)

        for child in elem:
            process_elem(child, depth + 1)

    process_elem(root)
    return elements

def parse_svg_regex(content):
    """Fallback regex parser"""
    elements = defaultdict(list)

    for tag in ['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line', 'image']:
        pattern = rf'<{tag}\s+([^>]*)/?>'
        for match in re.finditer(pattern, content, re.I):
            attrs_str = match.group(1)
            info = {'tag': tag}

            for attr in ['fill', 'stroke', 'stroke-width', 'stroke-dasharray',
                        'fill-opacity', 'stroke-opacity', 'opacity']:
                m = re.search(rf'{attr}="([^"]*)"', attrs_str)
                if m:
                    val = m.group(1)
                    info[attr] = val[:30] if len(val) > 30 else val

            if tag == 'path':
                m = re.search(r'd="([^"]*)"', attrs_str)
                if m:
                    info['d_len'] = len(m.group(1))
                    info['d_cmds'] = len(re.findall(r'[MLHVCSQTAZ]', m.group(1), re.I))

            if tag == 'polygon':
                m = re.search(r'points="([^"]*)"', attrs_str)
                if m:
                    info['points_count'] = len(m.group(1).split())

            elements[tag].append(info)

    return elements

def compare(orig_path, roundtrip_path):
    print(f"Original: {orig_path}")
    print(f"Roundtrip: {roundtrip_path}")
    print("=" * 60)

    orig = parse_svg(orig_path)
    rt = parse_svg(roundtrip_path)

    all_tags = set(orig.keys()) | set(rt.keys())

    print("\n### ELEMENT COUNTS ###")
    print(f"{'Tag':<12} {'Original':>10} {'Roundtrip':>10} {'Diff':>10}")
    print("-" * 44)
    for tag in sorted(all_tags):
        o_count = len(orig.get(tag, []))
        r_count = len(rt.get(tag, []))
        diff = r_count - o_count
        diff_str = f"+{diff}" if diff > 0 else str(diff)
        print(f"{tag:<12} {o_count:>10} {r_count:>10} {diff_str:>10}")

    print("\n### ORIGINAL ELEMENTS ###")
    for tag in sorted(orig.keys()):
        print(f"\n[{tag.upper()}] ({len(orig[tag])} elements)")
        for i, elem in enumerate(orig[tag][:5]):  # Show first 5
            attrs = {k: v for k, v in elem.items() if k != 'tag' and k != 'depth'}
            print(f"  {i}: {attrs}")
        if len(orig[tag]) > 5:
            print(f"  ... and {len(orig[tag]) - 5} more")

    print("\n### ROUNDTRIP ELEMENTS ###")
    for tag in sorted(rt.keys()):
        print(f"\n[{tag.upper()}] ({len(rt[tag])} elements)")
        for i, elem in enumerate(rt[tag][:5]):  # Show first 5
            attrs = {k: v for k, v in elem.items() if k != 'tag' and k != 'depth'}
            print(f"  {i}: {attrs}")
        if len(rt[tag]) > 5:
            print(f"  ... and {len(rt[tag]) - 5} more")

    # Attribute comparison
    print("\n### ATTRIBUTE ANALYSIS ###")

    # Check fills
    orig_fills = [e.get('fill') for t in orig.values() for e in t if e.get('fill')]
    rt_fills = [e.get('fill') for t in rt.values() for e in t if e.get('fill')]
    print(f"\nFills - Original: {len(orig_fills)}, Roundtrip: {len(rt_fills)}")
    print(f"  Orig unique: {set(orig_fills)}")
    print(f"  RT unique: {set(rt_fills)}")

    # Check strokes
    orig_strokes = [e.get('stroke') for t in orig.values() for e in t if e.get('stroke')]
    rt_strokes = [e.get('stroke') for t in rt.values() for e in t if e.get('stroke')]
    print(f"\nStrokes - Original: {len(orig_strokes)}, Roundtrip: {len(rt_strokes)}")

    # Check dash arrays
    orig_dash = [e.get('stroke-dasharray') for t in orig.values() for e in t if e.get('stroke-dasharray')]
    rt_dash = [e.get('stroke-dasharray') for t in rt.values() for e in t if e.get('stroke-dasharray')]
    print(f"\nDash arrays - Original: {len(orig_dash)}, Roundtrip: {len(rt_dash)}")
    if orig_dash:
        print(f"  Orig: {orig_dash[:3]}...")
    if rt_dash:
        print(f"  RT: {rt_dash[:3]}...")

if __name__ == '__main__':
    compare('test_page_1.svg', 'test_page_1.roundtrip.svg')
