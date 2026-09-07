"""Turn one TotalSegmentator subject into the two volumes the viewer needs: an intensity volume and
a label volume in which every voxel carries the index of the structure that owns it.

Masks are written smallest last, so where two overlap the more specific structure wins, which is the
one a reader would name. Volumes keep their native sampling; the viewer works in millimetres and
handles anisotropic spacing itself, which avoids blurring the data by resampling it."""
import gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
from scipy import ndimage
import nifti
from anatomy_names import describe

def human(name):
    """The name a report would use for a segmentation class, from tools/anatomy_names.py."""
    return describe(name.replace('.nii.gz', ''))[0]

STRAY_SHARE = .05

# A structure cut off by the edge of the field is normal: a study that stops at the neck holds part
# of a clavicle and part of a first rib, and those belong. What does not belong is a structure in a
# place it cannot be. This collection's labels put a fragment of skull at the foot end of a study
# whose highest slice is lung. Ordering catches that without touching anything legitimate.
MUST_LIE_ABOVE = {
 'skull':      ['lung_upper_lobe_left', 'lung_upper_lobe_right', 'heart', 'liver'],
 'brain':      ['lung_upper_lobe_left', 'lung_upper_lobe_right', 'heart', 'liver'],
 'clavicula_left':  ['liver', 'urinary_bladder'], 'clavicula_right': ['liver', 'urinary_bladder'],
 'femur_left': ['urinary_bladder'],               'femur_right':     ['urinary_bladder'],
}
def impossible(name, centroids):
    """True when a structure sits below something it must lie above."""
    below = MUST_LIE_ABOVE.get(name)
    if not below or name not in centroids: return None
    for other in below:
        if other in centroids and centroids[name] < centroids[other]:
            return other
    return None

def largest_parts(mask, share=STRAY_SHARE):
    """Drop connected components far smaller than the structure they claim to belong to.

    A segmentation model run over a body region it was not expecting leaves false positives: this
    collection's own labels put a fragment of skull among the toes of a study that stops at the neck.
    Structures that genuinely come in pieces, such as a set of rib cartilages, keep every piece that
    is a reasonable share of the whole; only the specks go."""
    if not mask.any(): return mask, 0
    parts, count = ndimage.label(mask)
    if count <= 1: return mask, 0
    sizes = np.bincount(parts.ravel())
    sizes[0] = 0
    keep = sizes >= max(1, sizes.max() * share)
    cleaned = keep[parts]
    return cleaned, int(mask.sum() - cleaned.sum())

def harmonise(values, axis=1, step=.16, shortest=20):
    """Put the stations of a stitched acquisition onto a common brightness.

    This is for magnetic resonance only. A CT is measured on an absolute scale and must never be
    rescaled this way: its Hounsfield numbers are the whole point of a window preset.

    Whole-body magnetic resonance is acquired in overlapping stations, each scaled on its own, and
    the joins show as bands: in this collection's whole-body T1 the head station runs about three
    times brighter than the trunk. Magnetic resonance carries no absolute scale, so nothing is lost
    by putting the stations on a common one.

    The joins are found rather than assumed. Walking the stack, a station edge is a slice where the
    body median jumps while the amount of body barely changes; where the body itself is changing,
    an arm or a leg entering the field, the change is anatomy and is left alone. Each station is
    then scaled as a block by its own median. Scaling per slice instead would flatten the real
    craniocaudal variation, and smoothing a gain curve across a step leaves half the step behind."""
    threshold = np.percentile(values, 70)
    count = values.shape[axis]
    level, area = np.full(count, np.nan), np.zeros(count)
    for i in range(count):
        slab = np.take(values, i, axis=axis)
        body = slab[slab > threshold]
        area[i] = body.size
        if body.size > 200: level[i] = np.median(body)
    index = np.arange(count)
    known = np.isfinite(level) & (level > 0)
    if known.sum() < 8: return values, None
    level = np.interp(index, index[known], level[known])

    joins = []
    for i in range(1, count):
        ratio = area[i] / max(1., area[i - 1])
        if ratio < .88 or ratio > 1.14: continue          # the body is changing, not the station
        if abs(level[i] - level[i - 1]) / max(1e-6, level[i - 1]) <= step: continue
        # A station spans many slices. Brightness that swings back and forth over two or three, as
        # it does through the neck where the anatomy changes quickly, is not a join; treating it as
        # one carves the stack into slivers and scales each against its neighbours, which writes a
        # flicker into the image that was never there.
        if joins and i - joins[-1] < shortest: continue
        if count - i < shortest: continue
        joins.append(i)
    if not joins: return values, None

    edges = [0, *joins, count]
    target = float(np.median(level))
    gain = np.ones(count)
    for start, stop in zip(edges, edges[1:]):
        if stop - start < 2: continue
        station = float(np.median(level[start:stop]))
        gain[start:stop] = np.clip(target / max(station, target * .05), .2, 5.)
    shape = [1, 1, 1]; shape[axis] = count
    return values * gain.reshape(shape), (len(joins), round(float(level.max() / max(1e-6, level.min())), 2))

def resample(volume, source_spacing, target_spacing, nearest=False):
    """Separable resampling along each axis. Intensity is interpolated, which also filters the
    noise and makes the result compress far better; labels take the nearest voxel, because an
    interpolated label index would name a structure that is not there."""
    out = volume if nearest else volume.astype(np.float32)
    for axis in range(3):
        count = out.shape[axis]
        target = max(1, int(round(count * source_spacing[axis] / target_spacing[axis])))
        if target == count: continue
        position = (np.arange(target) + .5) * target_spacing[axis] / source_spacing[axis] - .5
        low = np.clip(np.floor(position).astype(int), 0, count - 1)
        out = np.moveaxis(out, axis, 0)
        if nearest:
            out = out[np.clip(np.rint(position).astype(int), 0, count - 1)]
        else:
            high = np.clip(low + 1, 0, count - 1)
            weight = (position - low).astype(np.float32)[:, None, None]
            out = out[low] * (1 - weight) + out[high] * weight
        out = np.moveaxis(out, 0, axis)
    return out

def build(subject_dir, out_dir, modality, subject, source, target_spacing=None, weighting=None):
    volume_file = os.path.join(subject_dir, 'ct.nii.gz' if modality == 'ct' else 'mri.nii.gz')
    # The directory name matches the modality id the app uses, so the viewer's fetch path is simply
    # /imaging/<modality>.
    started = time.time()
    raw = nifti.read(volume_file)
    intensity, spacing = nifti.to_atlas(raw['data'], raw['affine'])
    values = intensity.astype(np.float32) * raw['slope'] + raw['inter']
    print(f'{modality}: {intensity.shape} at {tuple(round(s,2) for s in spacing)} mm, '
          f'values {values.min():.0f}..{values.max():.0f}')

    # Only magnetic resonance. A CT is measured on an absolute scale, so rescaling it would move
    # every Hounsfield value and the window presets would stop meaning anything.
    if modality != 'ct':
        values, banding = harmonise(values)
        if banding: print(f'  levelled {banding[0]} station joins (brightness ranged {banding[1]}x '
                          f'along the stack)')

    # Crop the air around the patient. It carries no information and, at 1.5 mm, the margins on a
    # body-sized field are a large share of the voxels.
    body = values > (-500 if modality == 'ct' else float(np.percentile(values, 55)))
    box = []
    for axis in range(3):
        present_on = np.any(body, axis=tuple(a for a in range(3) if a != axis))
        found = np.flatnonzero(present_on)
        pad = 4
        box.append((max(0, int(found[0]) - pad), min(body.shape[axis], int(found[-1]) + 1 + pad)))
    crop = tuple(slice(lo, hi) for lo, hi in box)
    before = values.shape
    values = values[crop]
    print(f'  cropped {before} -> {values.shape} '
          f'({100*np.prod(values.shape)/np.prod(before):.0f}% of the voxels)')

    masks = sorted(os.listdir(os.path.join(subject_dir, 'segmentations')))
    counts = []
    for i, name in enumerate(masks, 1):
        mask = nifti.read(os.path.join(subject_dir, 'segmentations', name))['data']
        counts.append((int(np.count_nonzero(mask)), name))
        if i % 30 == 0: print(f'  counted {i}/{len(masks)}', flush=True)
    present = [(n, c) for c, n in sorted(counts, reverse=True) if c > 0]
    print(f'  {len(present)} of {len(masks)} structures present in this study')

    labels = np.zeros(values.shape, dtype=np.uint8)
    names = []
    dropped, rejected, centroids = 0, [], {}
    for name, count in present:
        mask = nifti.read(os.path.join(subject_dir, 'segmentations', name))
        oriented, _ = nifti.to_atlas(mask['data'], mask['affine'])
        kept, removed = largest_parts(oriented[crop] > 0)
        dropped += removed
        stem = name.replace('.nii.gz', '')
        centroids[stem] = float(np.nonzero(kept)[1].mean())
        conflict = impossible(stem, centroids)
        if conflict:
            rejected.append(f'{human(name)} (below {conflict})')
            continue
        index = len(names) + 1
        labels[kept] = index                        # largest first, so smaller structures overwrite
        reported, latin = describe(stem)
        names.append({'index': index, 'file': stem, 'name': reported, 'latin': latin,
                      'voxels': int(kept.sum())})
    if dropped: print(f'  dropped {dropped} stray voxels in components under {int(STRAY_SHARE*100)}% of their structure')
    if rejected: print(f'  rejected {len(rejected)} anatomically impossible labels: {", ".join(rejected)}')

    if target_spacing:
        before = values.shape
        values = resample(values, spacing, target_spacing)
        labels = resample(labels, spacing, target_spacing, nearest=True)
        spacing = target_spacing
        print(f'  resampled {before} -> {values.shape} at {target_spacing[0]} mm')

    os.makedirs(out_dir, exist_ok=True)
    window = None
    if modality == 'ct':
        # Hounsfield units are kept, so the window presets act on real numbers.
        stored = np.clip(values + 1024, 0, 65535).astype(np.uint16)
        intensity_meta = {'dtype': 'uint16', 'encoding': 'split-bytes', 'slope': 1,
                          'inter': -1024, 'unit': 'HU'}
    else:
        # MR has no absolute scale, so it is normalised to the study's own upper percentile.
        ceiling = float(np.percentile(values, 99.5)) or 1.0
        stored = np.clip(values / ceiling * 255, 0, 255).astype(np.uint8)
        # Stored values are what the viewer windows, so slope stays at one; the original ceiling is
        # recorded for reference rather than applied.
        intensity_meta = {'dtype': 'uint8', 'encoding': 'plain', 'slope': 1, 'inter': 0,
                          'unit': 'stored 0-255', 'ceiling': round(ceiling, 2)}
        # Magnetic resonance has no absolute scale, so each study carries the window it should be
        # read at. Centring on the median of the body puts tissue at mid grey; a window centred on
        # the midpoint of the range instead would leave it dark, because the distribution has a long
        # bright tail of fat, fluid and vessels that drags the midpoint up.
        tissue = stored[stored > np.percentile(stored, 70)]
        middle = float(np.median(tissue))
        upper = float(np.percentile(tissue, 90))
        window = {'level': round(middle, 1), 'width': round(max(24., 2.2 * (upper - middle)), 1)}

    def write(name, array):
        # Sixteen-bit data is split into a plane of low bytes and a plane of high bytes before
        # compression. The high plane is nearly constant across a scan, so it compresses to almost
        # nothing, which is worth about a fifth of the file for free.
        payload = array.tobytes(order='C')
        if array.dtype == np.uint16:
            flat = array.ravel()
            payload = np.concatenate([(flat & 255).astype(np.uint8),
                                      (flat >> 8).astype(np.uint8)]).tobytes()
        path = os.path.join(out_dir, name)
        with gzip.open(path, 'wb', compresslevel=9) as f: f.write(payload)
        return os.path.getsize(path), array.nbytes

    vol_gz, vol_raw = write('volume.bin.gz', stored)
    lab_gz, lab_raw = write('labels.bin.gz', labels)
    manifest = {'modality': modality, 'subject': subject, 'weighting': weighting,
                'dims': list(values.shape), 'spacing': [round(s, 4) for s in spacing],
                'axes': 'x patient left, y superior, z anterior',
                'crop': [[int(lo), int(hi)] for lo, hi in box],
                'intensity': intensity_meta, 'window': window, 'structures': names, 'source': source,
                'bytes': {'volume': vol_gz, 'labels': lab_gz}}
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f: json.dump(manifest, f, indent=1)
    print(f'  volume {vol_raw/1e6:.0f} MB raw -> {vol_gz/1e6:.1f} MB gz; '
          f'labels {lab_raw/1e6:.0f} MB raw -> {lab_gz/1e6:.1f} MB gz; {time.time()-started:.0f}s')
    return manifest

if __name__ == '__main__':
    SOURCES = {
     'ct': {'dataset': 'TotalSegmentator', 'subject': 's0287',
            'doi': '10.5281/zenodo.10047292', 'url': 'https://zenodo.org/records/10047292',
            'licence': 'CC BY 4.0',
            'attribution': 'Wasserthal et al., TotalSegmentator, University Hospital Basel'},
     'mri': {'dataset': 'TotalSegmentator MRI', 'subject': 's0175',
             'doi': '10.5281/zenodo.11367005', 'url': 'https://zenodo.org/records/11367005',
             'licence': 'CC BY-NC-SA 2.0',
             'attribution': 'Akinci D’Antonoli et al., TotalSegmentator MRI, University Hospital Basel'},
    }
    # Weighting is measured from each study rather than read from its metadata, whose repetition and
    # echo times are recorded in mixed units across this collection. See tools/weighting.py.
    # The CT keeps the sampling the collection distributes, 1.5 mm, rather than being reduced
    # further: that is as fine as this source goes.
    build('data/raw/ct/s0287', 'public/imaging/ct', 'ct', 's0287', SOURCES['ct'])
    build('data/raw/ct/s0643', 'public/imaging/ct-head', 'ct', 's0643',
          dict(SOURCES['ct'], subject='s0643'))
    build('data/raw/mri/s0175', 'public/imaging/mr-t1', 'mr', 's0175',
          dict(SOURCES['mri'], subject='s0175'), weighting='T1')
    build('data/raw/mri/s0173', 'public/imaging/mr-t2', 'mr', 's0173',
          dict(SOURCES['mri'], subject='s0173'), weighting='T2')
    # The only near-isotropic study in the collection, so the only one whose sagittal and axial
    # reformats are as sharp as the plane it was acquired in.
    build('data/raw/mri/s0187', 'public/imaging/mr-t1fs', 'mr', 's0187',
          dict(SOURCES['mri'], subject='s0187'), weighting='T1 FS')
    build('data/raw/mri/s0190', 'public/imaging/mr-stir', 'mr', 's0190',
          dict(SOURCES['mri'], subject='s0190'), weighting='STIR')
