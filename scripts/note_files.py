"""Shared, fail-closed discovery of public note bundles (stdlib only)."""
from pathlib import Path
import re

NOTE_TYPES = {'.md', '.html', '.htm'}
PUBLIC_TYPES = NOTE_TYPES | {'.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif', '.ico', '.bmp', '.css', '.woff', '.woff2', '.ttf', '.otf', '.eot'}
PRIVATE_NAMES = {'private', 'raw', 'data', 'exports', 'secrets', 'credentials', 'node_modules'}


def public_name(name: str) -> bool:
    lower = name.lower()
    return not (name.startswith(('.', '_')) or lower in PRIVATE_NAMES or
                re.search(r'(^|[-_.])(secret|secrets|credential|credentials|password|token)([-_.]|$)', lower))


def checked_path(path: Path, boundary: Path) -> Path:
    """Reject lexical/resolved escapes and symlinks in any path component."""
    boundary = boundary.resolve()
    if not path.is_absolute():
        path = path.absolute()
    if not path.is_relative_to(boundary):
        raise ValueError(f'Path outside allowed boundary: {path}')
    current = boundary
    for part in path.relative_to(boundary).parts:
        current = current / part
        if current.is_symlink():
            raise ValueError(f'Symlink is not allowed: {current}')
    if not path.resolve().is_relative_to(boundary):
        raise ValueError(f'Path outside allowed boundary: {path}')
    return path


def public_files(root: Path) -> list[Path]:
    root = root.resolve()
    members = checked_path(root / 'members', root)
    if not members.is_dir():
        return []
    files = []

    def walk(folder):
        for path in sorted(folder.iterdir()):
            # Reject even hidden symlinks: do not silently hide unsafe inputs.
            checked_path(path, root)
            if not public_name(path.name):
                continue
            if path.is_dir():
                walk(path)
            elif path.is_file():
                files.append(path)

    for member in sorted(members.iterdir()):
        checked_path(member, root)
        if not public_name(member.name) or not member.is_dir():
            continue
        notes = checked_path(member / 'notes', root)
        if notes.is_dir():
            walk(notes)
    return files


def note_paths(root: Path) -> list[Path]:
    return [path for path in public_files(root) if path.suffix.lower() in NOTE_TYPES]
