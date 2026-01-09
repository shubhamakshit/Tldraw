# My Multiplayer App - Development Guidelines

## Overview
This is a collaborative drawing application built on top of ColorRM technology, featuring real-time multiplayer capabilities, advanced drawing tools, and document management features.

## Key Features
- Real-time collaborative drawing with Liveblocks integration
- Advanced drawing tools (pen, eraser, shapes, text, lasso)
- Document management (PDF import, page management)
- Template support (graph paper, lined paper, etc.)
- High-quality rendering with 2K default page sizes
- Touch-friendly interface with responsive design

## Development Guidelines

### Code Modification Best Practices
1. **Use small, specific replacements**: When modifying code, use the smallest possible string fragments to minimize unintended changes
2. **Always verify context**: Include sufficient context in `old_string` to ensure unique matching
3. **Test syntax**: After making changes, verify that the code remains syntactically correct
4. **Check for duplicates**: Avoid creating duplicate function definitions

### File Structure
- `public/scripts/` - Main application scripts
- `public/scripts/modules/` - Modular components (ColorRmSession, ColorRmInput, etc.)
- `public/color_rm.html` - Main application UI

### Common Issues to Avoid
- Missing closing braces for functions
- Duplicate function definitions
- Improper function separation
- Syntax errors in JavaScript modules

### Working with the ColorRmSession Module
This module handles:
- Page management (creation, deletion, resizing)
- Document import/export
- Collaboration features
- State management

When modifying this module:
- Ensure all functions are properly closed with braces
- Maintain consistent indentation
- Preserve existing functionality while adding new features
- Test thoroughly after changes

### Quality Standards
- Default to 2000x1500 page sizes for high quality output
- Use 0.95 JPEG quality for better visual fidelity
- Maintain responsive touch interactions
- Ensure proper error handling and user feedback

### Testing Protocol
After making changes:
1. Verify functionality in browser
2. Test collaborative features if applicable
3. Check mobile/touch interactions