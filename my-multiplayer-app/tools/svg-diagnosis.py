#!/usr/bin/env python3
"""
SVG Diagnosis Tool

Analyzes SVG files to understand structure, layering, and potential issues.
"""

import re
import sys
import json
from collections import defaultdict

def parse_viewbox(svg_content):
    """Extract viewBox dimensions"""
    match = re.search(r'viewBox="([^"]*)"', svg_content)
    if match:
        parts = match.group(1).split()
        if len(parts) >= 4:
            return {
                'minX': float(parts[0]),
                'minY': float(parts[1]),
                'width': float(parts[2]),
                'height': float(parts[3])
            }
    return None

def parse_dimensions(svg_content):
    """Extract width/height"""
    width_match = re.search(r'width="([^"]*)"', svg_content)
    height_match = re.search(r'height="([^"]*)"', svg_content)
    return {
        'width': width_match.group(1) if width_match else None,
        'height': height_match.group(1) if height_match else None
    }

def find_elements_with_order(svg_content):
    """Find all elements in order of appearance (z-order)"""
    # Pattern matches opening tags of drawable elements
    pattern = r'<((?:\w+:)?(?:path|rect|circle|ellipse|line|polyline|polygon|text|image|g))\s+([^>]*)(?:>|/>)'

    elements = []
    for i, match in enumerate(re.finditer(pattern, svg_content, re.IGNORECASE)):
        tag = match.group(1)
        attrs = match.group(2)

        # Extract key attributes
        elem_info = {
            'order': i,
            'tag': tag,
            'position': match.start()
        }

        # Get fill
        fill_match = re.search(r'fill="([^"]*)"', attrs)
        if fill_match:
            elem_info['fill'] = fill_match.group(1)

        # Get stroke
        stroke_match = re.search(r'stroke="([^"]*)"', attrs)
        if stroke_match:
            elem_info['stroke'] = stroke_match.group(1)

        # Get stroke-width
        sw_match = re.search(r'stroke-width="([^"]*)"', attrs)
        if sw_match:
            elem_info['stroke-width'] = sw_match.group(1)

        # Get opacity
        opacity_match = re.search(r'opacity="([^"]*)"', attrs)
        if opacity_match:
            elem_info['opacity'] = opacity_match.group(1)

        # Get fill-opacity
        fill_opacity_match = re.search(r'fill-opacity="([^"]*)"', attrs)
        if fill_opacity_match:
            elem_info['fill-opacity'] = fill_opacity_match.group(1)

        # Get id
        id_match = re.search(r'id="([^"]*)"', attrs)
        if id_match:
            elem_info['id'] = id_match.group(1)

        # Check for mask/clip
        if 'mask=' in attrs:
            elem_info['has_mask'] = True
        if 'clip-path=' in attrs:
            elem_info['has_clip'] = True

        # Get d attribute length for paths
        if 'path' in tag.lower():
            d_match = re.search(r'd="([^"]*)"', attrs)
            if d_match:
                elem_info['path_length'] = len(d_match.group(1))
                # Count path commands
                commands = len(re.findall(r'[MLHVCSQTAZ]', d_match.group(1), re.IGNORECASE))
                elem_info['path_commands'] = commands

        elements.append(elem_info)

    return elements

def analyze_stroke_widths(elements, viewbox):
    """Analyze stroke widths relative to canvas size"""
    stroke_analysis = []
    canvas_size = max(viewbox['width'], viewbox['height']) if viewbox else 1000

    for elem in elements:
        if 'stroke-width' in elem:
            sw = elem['stroke-width']
            try:
                sw_val = float(sw)
                relative = (sw_val / canvas_size) * 100
                stroke_analysis.append({
                    'tag': elem['tag'],
                    'order': elem['order'],
                    'stroke-width': sw_val,
                    'relative_percent': round(relative, 2),
                    'assessment': 'VERY THICK' if relative > 1 else 'THICK' if relative > 0.5 else 'NORMAL'
                })
            except ValueError:
                pass

    return stroke_analysis

def find_potential_background_elements(elements):
    """Find elements that might be acting as backgrounds (solid fills, early in order)"""
    backgrounds = []

    for elem in elements[:10]:  # Check first 10 elements
        fill = elem.get('fill', '')
        stroke = elem.get('stroke', '')

        # Large filled rect early in document could be background
        if 'rect' in elem['tag'].lower():
            if fill and fill != 'none' and fill != 'transparent':
                backgrounds.append({
                    'order': elem['order'],
                    'tag': elem['tag'],
                    'fill': fill,
                    'issue': 'Filled rect early in document - may cover content'
                })

        # Image early in document
        if 'image' in elem['tag'].lower():
            backgrounds.append({
                'order': elem['order'],
                'tag': elem['tag'],
                'issue': 'Image early in document - may cover content if large'
            })

    return backgrounds

def analyze_layering(elements):
    """Analyze element layering/z-order"""
    layer_stats = defaultdict(list)

    for elem in elements:
        tag_type = elem['tag'].split(':')[-1].lower()  # Remove namespace
        layer_stats[tag_type].append(elem['order'])

    report = {}
    for tag, orders in layer_stats.items():
        report[tag] = {
            'count': len(orders),
            'first_appearance': min(orders),
            'last_appearance': max(orders),
            'range': f"positions {min(orders)}-{max(orders)}"
        }

    return report

def check_namespace_issues(svg_content):
    """Check for namespace prefixes that might cause rendering issues"""
    namespaces = re.findall(r'xmlns:(\w+)="([^"]*)"', svg_content)
    prefixed_elements = re.findall(r'<(\w+):', svg_content)

    return {
        'declared_namespaces': namespaces,
        'prefixed_element_count': len(prefixed_elements),
        'unique_prefixes': list(set(prefixed_elements))
    }

def compare_two_svgs(file1, file2):
    """Compare two SVG files"""
    with open(file1, 'r') as f:
        content1 = f.read()
    with open(file2, 'r') as f:
        content2 = f.read()

    elements1 = find_elements_with_order(content1)
    elements2 = find_elements_with_order(content2)

    viewbox1 = parse_viewbox(content1)
    viewbox2 = parse_viewbox(content2)

    comparison = {
        'file1': {
            'name': file1,
            'size': len(content1),
            'element_count': len(elements1),
            'viewbox': viewbox1
        },
        'file2': {
            'name': file2,
            'size': len(content2),
            'element_count': len(elements2),
            'viewbox': viewbox2
        }
    }

    # Compare stroke widths
    strokes1 = analyze_stroke_widths(elements1, viewbox1)
    strokes2 = analyze_stroke_widths(elements2, viewbox2)

    comparison['stroke_width_comparison'] = {
        'file1_thick_strokes': [s for s in strokes1 if s['assessment'] in ['THICK', 'VERY THICK']],
        'file2_thick_strokes': [s for s in strokes2 if s['assessment'] in ['THICK', 'VERY THICK']]
    }

    # Compare layering
    comparison['layering'] = {
        'file1': analyze_layering(elements1),
        'file2': analyze_layering(elements2)
    }

    return comparison

def analyze_svg(filepath):
    """Main analysis function"""
    print(f"\n{'='*60}")
    print(f"SVG DIAGNOSIS: {filepath}")
    print('='*60)

    with open(filepath, 'r') as f:
        content = f.read()

    print(f"\n📊 FILE SIZE: {len(content):,} bytes ({len(content)//1024} KB)")

    # Dimensions
    dims = parse_dimensions(content)
    viewbox = parse_viewbox(content)
    print(f"\n📐 DIMENSIONS:")
    print(f"   Width: {dims['width']}")
    print(f"   Height: {dims['height']}")
    if viewbox:
        print(f"   ViewBox: {viewbox['minX']} {viewbox['minY']} {viewbox['width']} {viewbox['height']}")

    # Namespace issues
    ns_info = check_namespace_issues(content)
    if ns_info['prefixed_element_count'] > 0:
        print(f"\n⚠️  NAMESPACE PREFIXES DETECTED:")
        print(f"   Prefixed elements: {ns_info['prefixed_element_count']}")
        print(f"   Prefixes used: {ns_info['unique_prefixes']}")
        print(f"   Note: Some browsers may not render prefixed elements correctly!")

    # Elements
    elements = find_elements_with_order(content)
    print(f"\n📦 ELEMENTS FOUND: {len(elements)}")

    # Layering analysis
    layering = analyze_layering(elements)
    print(f"\n🔢 ELEMENT LAYERING (z-order):")
    for tag, info in sorted(layering.items(), key=lambda x: x[1]['first_appearance']):
        print(f"   {tag}: {info['count']} elements, {info['range']}")

    # Background issues
    bg_issues = find_potential_background_elements(elements)
    if bg_issues:
        print(f"\n⚠️  POTENTIAL BACKGROUND/LAYERING ISSUES:")
        for issue in bg_issues:
            print(f"   Order {issue['order']}: {issue['tag']} - {issue['issue']}")
            if 'fill' in issue:
                print(f"      Fill: {issue['fill']}")

    # Stroke width analysis
    stroke_analysis = analyze_stroke_widths(elements, viewbox)
    thick_strokes = [s for s in stroke_analysis if s['assessment'] in ['THICK', 'VERY THICK']]
    if thick_strokes:
        print(f"\n⚠️  THICK STROKE WIDTHS DETECTED ({len(thick_strokes)} elements):")
        for s in thick_strokes[:10]:  # Show first 10
            print(f"   Order {s['order']}: {s['tag']} - width={s['stroke-width']} ({s['relative_percent']}% of canvas)")
        if len(thick_strokes) > 10:
            print(f"   ... and {len(thick_strokes) - 10} more")

    # Sample elements
    print(f"\n📋 FIRST 10 ELEMENTS (in z-order):")
    for elem in elements[:10]:
        parts = [f"Order {elem['order']}: <{elem['tag']}>"]
        if 'fill' in elem:
            parts.append(f"fill={elem['fill']}")
        if 'stroke' in elem:
            parts.append(f"stroke={elem['stroke']}")
        if 'stroke-width' in elem:
            parts.append(f"sw={elem['stroke-width']}")
        if 'opacity' in elem:
            parts.append(f"opacity={elem['opacity']}")
        if 'path_length' in elem:
            parts.append(f"d_len={elem['path_length']}")
        print(f"   {' | '.join(parts)}")

    # Last 5 elements (top of z-order)
    if len(elements) > 10:
        print(f"\n📋 LAST 5 ELEMENTS (top of z-order):")
        for elem in elements[-5:]:
            parts = [f"Order {elem['order']}: <{elem['tag']}>"]
            if 'fill' in elem:
                parts.append(f"fill={elem['fill']}")
            if 'stroke' in elem:
                parts.append(f"stroke={elem['stroke']}")
            if 'stroke-width' in elem:
                parts.append(f"sw={elem['stroke-width']}")
            print(f"   {' | '.join(parts)}")

    return {
        'filepath': filepath,
        'size': len(content),
        'dimensions': dims,
        'viewbox': viewbox,
        'element_count': len(elements),
        'namespaces': ns_info,
        'layering': layering,
        'thick_strokes': thick_strokes,
        'background_issues': bg_issues
    }

def main():
    if len(sys.argv) < 2:
        print("""
SVG Diagnosis Tool
==================

Usage:
  python svg-diagnosis.py <file.svg>           # Analyze single SVG
  python svg-diagnosis.py <file1.svg> <file2.svg>  # Compare two SVGs

Diagnoses:
  - Stroke width issues (too thick)
  - Layering/z-order problems (background covering content)
  - Namespace prefix issues
  - ViewBox problems
""")
        sys.exit(0)

    if len(sys.argv) == 2:
        analyze_svg(sys.argv[1])
    elif len(sys.argv) >= 3:
        print("\n" + "="*60)
        print("COMPARING TWO SVG FILES")
        print("="*60)

        analyze_svg(sys.argv[1])
        analyze_svg(sys.argv[2])

        comparison = compare_two_svgs(sys.argv[1], sys.argv[2])

        print("\n" + "="*60)
        print("COMPARISON SUMMARY")
        print("="*60)
        print(f"\nFile 1: {comparison['file1']['element_count']} elements, {comparison['file1']['size']//1024}KB")
        print(f"File 2: {comparison['file2']['element_count']} elements, {comparison['file2']['size']//1024}KB")

        thick1 = comparison['stroke_width_comparison']['file1_thick_strokes']
        thick2 = comparison['stroke_width_comparison']['file2_thick_strokes']
        print(f"\nThick strokes: File1={len(thick1)}, File2={len(thick2)}")

if __name__ == '__main__':
    main()
