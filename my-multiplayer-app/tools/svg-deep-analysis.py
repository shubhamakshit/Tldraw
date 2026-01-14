#!/usr/bin/env python3
"""
SVG Deep Analysis Tool

Deeper analysis of the original SVG structure to understand the exact pattern
"""

import re
import sys
from collections import defaultdict

def extract_paths_with_details(svg_content, limit=50):
    """Extract detailed path information"""
    # More robust pattern for paths
    path_pattern = r'<(?:\w+:)?path\s+([^>]*)/?>'

    paths = []
    for i, match in enumerate(re.finditer(path_pattern, svg_content, re.IGNORECASE)):
        if i >= limit:
            break

        attrs_str = match.group(1)

        # Parse all attributes
        attrs = {}
        for attr_match in re.finditer(r'(\w+(?:-\w+)*)="([^"]*)"', attrs_str):
            attrs[attr_match.group(1)] = attr_match.group(2)

        # Get d length
        d = attrs.get('d', '')
        attrs['_d_length'] = len(d)
        attrs['_d_preview'] = d[:100] + '...' if len(d) > 100 else d

        paths.append({
            'index': i,
            'position': match.start(),
            'attrs': attrs
        })

    return paths

def analyze_path_patterns(paths):
    """Analyze patterns in path definitions"""
    patterns = []

    for i in range(0, min(len(paths), 20), 2):
        if i + 1 < len(paths):
            p1 = paths[i]['attrs']
            p2 = paths[i + 1]['attrs']

            same_d = p1.get('d', '') == paths[i+1]['attrs'].get('d', '') if '_d_length' not in p1 else p1.get('_d_length') == p2.get('_d_length')

            pattern = {
                'pair': f"{i} & {i+1}",
                'same_path_data': same_d,
                'path1': {
                    'fill': p1.get('fill'),
                    'stroke': p1.get('stroke'),
                    'opacity': p1.get('opacity'),
                    'fill-opacity': p1.get('fill-opacity'),
                    'stroke-width': p1.get('stroke-width')
                },
                'path2': {
                    'fill': p2.get('fill'),
                    'stroke': p2.get('stroke'),
                    'opacity': p2.get('opacity'),
                    'fill-opacity': p2.get('fill-opacity'),
                    'stroke-width': p2.get('stroke-width')
                }
            }
            patterns.append(pattern)

    return patterns

def find_group_structure(svg_content):
    """Analyze group nesting structure"""
    # Find all groups and their attributes
    group_pattern = r'<(?:\w+:)?g\s+([^>]*)>'

    groups = []
    for match in re.finditer(group_pattern, svg_content, re.IGNORECASE):
        attrs_str = match.group(1)
        attrs = {}
        for attr_match in re.finditer(r'(\w+(?:-\w+)*)="([^"]*)"', attrs_str):
            attrs[attr_match.group(1)] = attr_match.group(2)

        groups.append({
            'position': match.start(),
            'attrs': attrs
        })

    return groups

def main():
    if len(sys.argv) < 2:
        print("Usage: python svg-deep-analysis.py <file.svg>")
        sys.exit(1)

    filepath = sys.argv[1]
    with open(filepath, 'r') as f:
        content = f.read()

    print(f"\n{'='*70}")
    print(f"DEEP SVG ANALYSIS: {filepath}")
    print('='*70)

    # Analyze groups
    groups = find_group_structure(content)
    print(f"\n📁 GROUPS ({len(groups)}):")
    for i, g in enumerate(groups[:10]):
        print(f"   Group {i}: {g['attrs']}")

    # Analyze paths in detail
    paths = extract_paths_with_details(content, limit=30)

    print(f"\n📝 FIRST 30 PATHS DETAILS:")
    for p in paths[:30]:
        attrs = p['attrs']
        print(f"\n   Path {p['index']}:")
        print(f"      fill: {attrs.get('fill', 'NONE')}")
        print(f"      stroke: {attrs.get('stroke', 'NONE')}")
        print(f"      stroke-width: {attrs.get('stroke-width', 'NONE')}")
        print(f"      opacity: {attrs.get('opacity', 'NONE')}")
        print(f"      fill-opacity: {attrs.get('fill-opacity', 'NONE')}")
        print(f"      d length: {attrs.get('_d_length')}")

    # Analyze patterns
    patterns = analyze_path_patterns(paths)
    print(f"\n🔍 PATH PAIR PATTERNS (checking if paths come in fill+stroke pairs):")
    for p in patterns:
        print(f"\n   {p['pair']}:")
        print(f"      Same path data: {p['same_path_data']}")
        print(f"      Path 1: fill={p['path1']['fill']}, stroke={p['path1']['stroke']}, opacity={p['path1']['opacity']}")
        print(f"      Path 2: fill={p['path2']['fill']}, stroke={p['path2']['stroke']}, sw={p['path2']['stroke-width']}")

    # Look for image elements
    image_pattern = r'<(?:\w+:)?image\s+([^>]*)/?>'
    images = list(re.finditer(image_pattern, content, re.IGNORECASE))
    print(f"\n🖼️  IMAGES ({len(images)}):")
    for i, img in enumerate(images):
        attrs_str = img.group(1)
        # Extract key attrs
        x = re.search(r'x="([^"]*)"', attrs_str)
        y = re.search(r'y="([^"]*)"', attrs_str)
        w = re.search(r'width="([^"]*)"', attrs_str)
        h = re.search(r'height="([^"]*)"', attrs_str)
        mask = re.search(r'mask="([^"]*)"', attrs_str)

        print(f"   Image {i} at position {img.start()}:")
        print(f"      x={x.group(1) if x else 'N/A'}, y={y.group(1) if y else 'N/A'}")
        print(f"      w={w.group(1) if w else 'N/A'}, h={h.group(1) if h else 'N/A'}")
        print(f"      mask={mask.group(1) if mask else 'NONE'}")

    print("\n" + "="*70)
    print("DIAGNOSIS SUMMARY")
    print("="*70)

    print("""
Based on this analysis, the SVG structure is:

1. PATHS COME IN PAIRS:
   - First path: Colored FILL with low opacity (e.g., fill=#ff7d2e opacity=.03)
                 This creates the "highlighter" effect
   - Second path: Same geometry with STROKE only (stroke=#000000 stroke-width=2)
                 This creates a thin outline

2. ISSUE WITH CONVERTER:
   - We're treating filled paths and stroked paths separately
   - We should recognize these as a SINGLE stroke with:
     * color from the fill
     * stroke-width from the companion stroke path (or default to 2)
     * opacity from the fill-opacity or opacity

3. IMAGES:
   - Images appear EARLY in the document (as backgrounds)
   - Our converter outputs them LAST (covering content)

FIX NEEDED:
   - Detect fill+stroke path pairs (same d attribute)
   - Merge them into single ColorRM item
   - Preserve element order (images first = background)
""")

if __name__ == '__main__':
    main()
