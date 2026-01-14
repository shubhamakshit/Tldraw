#!/usr/bin/env python3
"""
Deep SVG Group Analysis - Find what's being missed
"""

import re
import sys

def analyze_groups(svg_content):
    """Analyze group structure and transforms"""

    # Find all groups
    group_pattern = r'<(?:\w+:)?g\s+([^>]*)>'
    groups = []

    for match in re.finditer(group_pattern, svg_content, re.IGNORECASE):
        attrs = match.group(1)
        pos = match.start()

        # Extract transform
        transform_match = re.search(r'transform="([^"]*)"', attrs)
        transform = transform_match.group(1) if transform_match else None

        groups.append({
            'position': pos,
            'attrs': attrs,
            'transform': transform
        })

    return groups

def find_elements_in_groups(svg_content):
    """Find which elements are inside groups vs top-level"""

    # Count total elements
    all_paths = len(re.findall(r'<(?:\w+:)?path\s+', svg_content, re.IGNORECASE))
    all_images = len(re.findall(r'<(?:\w+:)?image\s+', svg_content, re.IGNORECASE))

    # Remove group content and count remaining
    no_groups = re.sub(r'<(?:\w+:)?g[^>]*>[\s\S]*?</(?:\w+:)?g>', '', svg_content)
    top_level_paths = len(re.findall(r'<(?:\w+:)?path\s+', no_groups, re.IGNORECASE))
    top_level_images = len(re.findall(r'<(?:\w+:)?image\s+', no_groups, re.IGNORECASE))

    return {
        'total_paths': all_paths,
        'paths_in_groups': all_paths - top_level_paths,
        'top_level_paths': top_level_paths,
        'total_images': all_images,
        'images_in_groups': all_images - top_level_images,
        'top_level_images': top_level_images
    }

def find_bounding_boxes(svg_content):
    """Find coordinate ranges to detect if lower half is missing"""

    # Extract all Y coordinates from paths
    y_coords = []

    # From path d attributes - look for M, L, V commands with Y values
    path_pattern = r'd="([^"]*)"'
    for match in re.finditer(path_pattern, svg_content):
        d = match.group(1)
        # Extract numbers after M, L commands (every second number is Y)
        coords = re.findall(r'[ML]\s*([-\d.]+)\s+([-\d.]+)', d, re.IGNORECASE)
        for x, y in coords:
            try:
                y_coords.append(float(y))
            except:
                pass

    if y_coords:
        return {
            'min_y': min(y_coords),
            'max_y': max(y_coords),
            'y_range': max(y_coords) - min(y_coords)
        }
    return None

def analyze_nested_groups(svg_content):
    """Find deeply nested groups"""

    # Find group opening/closing tags
    opens = [(m.start(), 'open') for m in re.finditer(r'<(?:\w+:)?g\s+[^>]*>', svg_content, re.IGNORECASE)]
    closes = [(m.start(), 'close') for m in re.finditer(r'</(?:\w+:)?g>', svg_content, re.IGNORECASE)]

    all_tags = sorted(opens + closes, key=lambda x: x[0])

    max_depth = 0
    current_depth = 0
    depth_counts = {}

    for pos, tag_type in all_tags:
        if tag_type == 'open':
            current_depth += 1
            max_depth = max(max_depth, current_depth)
            depth_counts[current_depth] = depth_counts.get(current_depth, 0) + 1
        else:
            current_depth -= 1

    return {
        'max_nesting_depth': max_depth,
        'groups_at_each_depth': depth_counts
    }

def check_transform_types(svg_content):
    """Check what transform types are used"""

    transforms = re.findall(r'transform="([^"]*)"', svg_content)

    types = {
        'matrix': 0,
        'translate': 0,
        'scale': 0,
        'rotate': 0,
        'skew': 0
    }

    for t in transforms:
        if 'matrix' in t:
            types['matrix'] += 1
        if 'translate' in t:
            types['translate'] += 1
        if 'scale' in t:
            types['scale'] += 1
        if 'rotate' in t:
            types['rotate'] += 1
        if 'skew' in t:
            types['skew'] += 1

    return types

def main():
    if len(sys.argv) < 2:
        print("Usage: python svg-group-analysis.py <file.svg>")
        sys.exit(1)

    filepath = sys.argv[1]
    with open(filepath, 'r') as f:
        content = f.read()

    print(f"\n{'='*60}")
    print(f"SVG GROUP ANALYSIS: {filepath}")
    print('='*60)

    # Basic counts
    elem_counts = find_elements_in_groups(content)
    print(f"\n📊 ELEMENT DISTRIBUTION:")
    print(f"   Total paths: {elem_counts['total_paths']}")
    print(f"   - In groups: {elem_counts['paths_in_groups']}")
    print(f"   - Top level: {elem_counts['top_level_paths']}")
    print(f"   Total images: {elem_counts['total_images']}")
    print(f"   - In groups: {elem_counts['images_in_groups']}")
    print(f"   - Top level: {elem_counts['top_level_images']}")

    # Group nesting
    nesting = analyze_nested_groups(content)
    print(f"\n📁 GROUP NESTING:")
    print(f"   Max depth: {nesting['max_nesting_depth']}")
    print(f"   Groups at each depth: {nesting['groups_at_each_depth']}")

    # Transforms
    transforms = check_transform_types(content)
    print(f"\n🔄 TRANSFORMS USED:")
    for t, count in transforms.items():
        if count > 0:
            print(f"   {t}: {count}")

    # Groups with transforms
    groups = analyze_groups(content)
    groups_with_transforms = [g for g in groups if g['transform']]
    print(f"\n🔧 GROUPS WITH TRANSFORMS: {len(groups_with_transforms)}")
    for g in groups_with_transforms[:5]:
        print(f"   transform: {g['transform'][:60]}...")

    # Bounding box
    bbox = find_bounding_boxes(content)
    if bbox:
        print(f"\n📐 Y-COORDINATE RANGE:")
        print(f"   Min Y: {bbox['min_y']:.2f}")
        print(f"   Max Y: {bbox['max_y']:.2f}")
        print(f"   Range: {bbox['y_range']:.2f}")

    # ViewBox
    viewbox_match = re.search(r'viewBox="([^"]*)"', content)
    if viewbox_match:
        vb = viewbox_match.group(1).split()
        if len(vb) >= 4:
            vb_height = float(vb[3])
            print(f"   ViewBox height: {vb_height}")
            if bbox:
                coverage = (bbox['max_y'] - bbox['min_y']) / vb_height * 100
                print(f"   Content covers: {coverage:.1f}% of viewBox height")

if __name__ == '__main__':
    main()
