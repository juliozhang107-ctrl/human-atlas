"""Minimal NIfTI-1 reader, and reorientation into the atlas's own axes.

NIfTI stores an affine that maps voxel indices to RAS+ millimetres: +x right, +y anterior,
+z superior. This atlas uses +x patient left, +y superior, +z anterior. Rather than assume any
particular storage order, the affine is read and the volume is transposed and flipped into the
atlas frame, which is what keeps a coronal image from silently coming out mirrored."""
import gzip, struct
import numpy as np

DATATYPES = {2: np.uint8, 4: np.int16, 8: np.int32, 16: np.float32, 64: np.float64,
             256: np.int8, 512: np.uint16, 768: np.uint32}

def read(path):
    with gzip.open(path, 'rb') as f:
        raw = f.read()
    end = '<' if struct.unpack('<i', raw[:4])[0] == 348 else '>'
    dim = struct.unpack(end + '8h', raw[40:56])
    datatype = struct.unpack(end + 'h', raw[70:72])[0]
    pixdim = struct.unpack(end + '8f', raw[76:108])
    vox_offset = int(struct.unpack(end + 'f', raw[108:112])[0]) or 352
    slope, inter = struct.unpack(end + '2f', raw[112:120])
    sform_code = struct.unpack(end + 'h', raw[254:256])[0]
    srow = np.array([struct.unpack(end + '4f', raw[280 + 16 * i: 296 + 16 * i]) for i in range(3)])
    shape = tuple(dim[1:1 + dim[0]])
    data = np.frombuffer(raw, dtype=DATATYPES[datatype], count=int(np.prod(shape)), offset=vox_offset)
    data = data.reshape(shape, order='F')
    if sform_code == 0:  # fall back to a diagonal affine from the voxel sizes
        srow = np.diag(pixdim[1:4]).astype(np.float64)
        srow = np.hstack([srow, np.zeros((3, 1))])
    return {'data': data, 'affine': srow, 'pixdim': pixdim[1:4],
            'slope': slope if slope else 1.0, 'inter': inter}

# Atlas axes expressed in RAS: patient left is -x, superior is +z, anterior is +y.
ATLAS_FROM_RAS = [(0, -1), (2, 1), (1, 1)]

def to_atlas(volume, affine):
    """Transpose and flip a volume so index order becomes (left, superior, anterior).
    Returns the reoriented array and the voxel spacing along those axes."""
    direction = affine[:3, :3]
    spacing = np.linalg.norm(direction, axis=0)
    unit = direction / np.where(spacing == 0, 1, spacing)
    order, flips, sizes = [], [], []
    for ras_axis, sign in ATLAS_FROM_RAS:
        source = int(np.argmax(np.abs(unit[ras_axis])))
        order.append(source)
        flips.append(np.sign(unit[ras_axis, source]) * sign < 0)
        sizes.append(spacing[source])
    if sorted(order) != [0, 1, 2]:
        raise ValueError(f'affine does not map cleanly onto three axes: {order}')
    out = np.transpose(volume, order)
    for axis, flip in enumerate(flips):
        if flip: out = np.flip(out, axis=axis)
    return np.ascontiguousarray(out), tuple(float(s) for s in sizes)
