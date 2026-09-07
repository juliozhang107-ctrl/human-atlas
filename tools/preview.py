"""Render slices straight from the built volumes, to check the data before the app touches it."""
import gzip, json, os, struct, sys, zlib
import numpy as np

def load(directory):
    manifest = json.load(open(os.path.join(directory, 'manifest.json')))
    dims = tuple(manifest['dims']); count = int(np.prod(dims))
    raw = gzip.open(os.path.join(directory, 'volume.bin.gz'), 'rb').read()
    if manifest['intensity']['encoding'] == 'split-bytes':
        low = np.frombuffer(raw, np.uint8, count, 0).astype(np.uint16)
        high = np.frombuffer(raw, np.uint8, count, count).astype(np.uint16)
        volume = (low | (high << 8)).reshape(dims)
    else:
        volume = np.frombuffer(raw, np.uint8, count).reshape(dims)
    labels = np.frombuffer(gzip.open(os.path.join(directory, 'labels.bin.gz'), 'rb').read(),
                           np.uint8, count).reshape(dims)
    return manifest, volume, labels

def png(path, grey):
    height, width = grey.shape
    raw = b''.join(b'\x00' + grey[y].tobytes() for y in range(height))
    def chunk(kind, data):
        body = kind + data
        return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body))
    header = struct.pack('>IIBBBBB', width, height, 8, 0, 0, 0, 0)
    open(path, 'wb').write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', header)
                           + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

def window(values, width, level):
    return np.clip((values - (level - width / 2)) / width, 0, 1)

if __name__ == '__main__':
    for directory, plane, index, out, win in [
        ('public/imaging/ct', 1, .52, 'v1-ct-axial.png', (400, 40)),
        ('public/imaging/ct', 1, .52, 'v2-ct-axial-bone.png', (2000, 400)),
        ('public/imaging/ct', 2, .55, 'v3-ct-coronal.png', (400, 40)),
        ('public/imaging/mri', 2, .5, 'v4-mri-coronal.png', None),
        ('public/imaging/mri', 0, .5, 'v5-mri-sagittal.png', None),
    ]:
        manifest, volume, labels = load(directory)
        dims, spacing = manifest['dims'], manifest['spacing']
        at = int(dims[plane] * index)
        cut = [slice(None)] * 3; cut[plane] = at
        image = volume[tuple(cut)].astype(np.float32)
        image = image * manifest['intensity']['slope'] + manifest['intensity']['inter']
        grey = window(image, *win) if win else window(image, image.max() or 1, (image.max() or 1) / 2)
        # Orient for display: rows run down the second remaining axis, columns along the first.
        axes = [a for a in range(3) if a != plane]
        grey = grey.T if axes[1] > axes[0] else grey
        grey = np.flipud(grey) if 1 in axes else grey
        aspect = spacing[axes[1]] / spacing[axes[0]]
        out_grey = (grey * 255).astype(np.uint8)
        if abs(aspect - 1) > .05:   # stretch to square pixels
            rows = int(out_grey.shape[0] * aspect)
            pick = np.clip((np.arange(rows) / aspect).astype(int), 0, out_grey.shape[0] - 1)
            out_grey = out_grey[pick]
        png(out, np.ascontiguousarray(out_grey))
        named = sorted({int(v) for v in np.unique(labels[tuple(cut)]) if v})
        print(f'{out}: {out_grey.shape[1]}x{out_grey.shape[0]}, {len(named)} structures in this slice')
