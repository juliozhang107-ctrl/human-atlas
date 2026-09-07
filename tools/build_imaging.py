"""Turn one TotalSegmentator subject into the two volumes the viewer needs: an intensity volume and
a label volume in which every voxel carries the index of the structure that owns it.

Masks are written smallest last, so where two overlap the more specific structure wins, which is the
one a reader would name. Volumes keep their native sampling; the viewer works in millimetres and
handles anisotropic spacing itself, which avoids blurring the data by resampling it."""
import gzip, json, os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import nifti

def human(name):
    """TotalSegmentator file names into something a reader would recognise."""
    parts = name.replace('.nii.gz', '').split('_')
    tail = {'left': 'left', 'right': 'right'}
    side = ''
    if parts[-1] in tail: side, parts = parts.pop(), parts
    text = ' '.join(parts).replace('vertebrae', 'vertebra').replace('costa', 'rib')
    text = text[0].upper() + text[1:]
    return f'{side.capitalize()} {text[0].lower()}{text[1:]}' if side else text

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

def build(subject_dir, out_dir, modality, subject, source, target_spacing=None):
    volume_file = os.path.join(subject_dir, 'ct.nii.gz' if modality == 'ct' else 'mri.nii.gz')
    # The directory name matches the modality id the app uses, so the viewer's fetch path is simply
    # /imaging/<modality>.
    started = time.time()
    raw = nifti.read(volume_file)
    intensity, spacing = nifti.to_atlas(raw['data'], raw['affine'])
    values = intensity.astype(np.float32) * raw['slope'] + raw['inter']
    print(f'{modality}: {intensity.shape} at {tuple(round(s,2) for s in spacing)} mm, '
          f'values {values.min():.0f}..{values.max():.0f}')

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
    for index, (name, count) in enumerate(present, 1):
        mask = nifti.read(os.path.join(subject_dir, 'segmentations', name))
        oriented, _ = nifti.to_atlas(mask['data'], mask['affine'])
        labels[oriented[crop] > 0] = index          # largest first, so smaller structures overwrite
        names.append({'index': index, 'file': name.replace('.nii.gz', ''),
                      'name': human(name), 'voxels': count})

    if target_spacing:
        before = values.shape
        values = resample(values, spacing, target_spacing)
        labels = resample(labels, spacing, target_spacing, nearest=True)
        spacing = target_spacing
        print(f'  resampled {before} -> {values.shape} at {target_spacing[0]} mm')

    os.makedirs(out_dir, exist_ok=True)
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
    manifest = {'modality': modality, 'subject': subject,
                'dims': list(values.shape), 'spacing': [round(s, 4) for s in spacing],
                'axes': 'x patient left, y superior, z anterior',
                'crop': [[int(lo), int(hi)] for lo, hi in box],
                'intensity': intensity_meta, 'structures': names, 'source': source,
                'bytes': {'volume': vol_gz, 'labels': lab_gz}}
    with open(os.path.join(out_dir, 'manifest.json'), 'w') as f: json.dump(manifest, f, indent=1)
    print(f'  volume {vol_raw/1e6:.0f} MB raw -> {vol_gz/1e6:.1f} MB gz; '
          f'labels {lab_raw/1e6:.0f} MB raw -> {lab_gz/1e6:.1f} MB gz; {time.time()-started:.0f}s')
    return manifest

if __name__ == '__main__':
    SOURCES = {
     'ct': {'dataset': 'TotalSegmentator', 'subject': 's0250',
            'doi': '10.5281/zenodo.10047292', 'url': 'https://zenodo.org/records/10047292',
            'licence': 'CC BY 4.0',
            'attribution': 'Wasserthal et al., TotalSegmentator, University Hospital Basel'},
     'mri': {'dataset': 'TotalSegmentator MRI', 'subject': 's0175',
             'doi': '10.5281/zenodo.11367005', 'url': 'https://zenodo.org/records/11367005',
             'licence': 'CC BY-NC-SA 2.0',
             'attribution': 'Akinci D’Antonoli et al., TotalSegmentator MRI, University Hospital Basel'},
    }
    build('data/raw/ct/s0250', 'public/imaging/ct', 'ct', 's0250', SOURCES['ct'],
          target_spacing=(2.0, 2.0, 2.0))
    build('data/raw/mri/s0175', 'public/imaging/mr', 'mr', 's0175', SOURCES['mri'])
