"""Work out what a study is weighted for from the image rather than from its metadata, whose
repetition and echo times are recorded in mixed units across this collection.

Urine in the bladder is nearly free water and liver is not, so their signal ratio separates the two
weightings cleanly: on T1 urine is dark against liver, on T2 it is much brighter. Fat against
muscle confirms it, and a study where fat is dark while fluid is bright has had its fat suppressed."""
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import numpy as np
import nifti

def signal(subject_dir, name, volume):
    path = os.path.join(subject_dir, 'segmentations', f'{name}.nii.gz')
    if not os.path.exists(path): return None
    mask = nifti.read(path)['data'] > 0
    if mask.sum() < 200: return None
    return float(np.median(volume[mask]))

def subcutaneous(volume, depth=6):
    """Median signal in the rim just inside the body outline, which is subcutaneous fat. The body is
    everything above a low threshold; eroding it by a few voxels and taking the difference gives the
    rim without needing a mask for it.

    This, and every other ratio here, compares one region of a study against another, so it is only
    valid within a single station. A stitched whole-body acquisition scales each station separately,
    and comparing its liver against its bladder measures the stitching as much as the tissue."""
    body = volume > np.percentile(volume, 60)
    if body.sum() < 1000: return None
    inner = body.copy()
    for _ in range(depth):
        shrunk = inner.copy()
        for axis in (0, 1, 2):
            shrunk &= np.roll(inner, 1, axis) & np.roll(inner, -1, axis)
        inner = shrunk
    rim = body & ~inner
    return float(np.median(volume[rim])) if rim.sum() > 500 else None

def classify(subject_dir, modality_file='mri.nii.gz'):
    raw = nifti.read(os.path.join(subject_dir, modality_file))
    volume = raw['data'].astype(np.float32) * raw['slope'] + raw['inter']
    parts = {n: signal(subject_dir, n, volume) for n in
             ('urinary_bladder', 'liver', 'spleen', 'kidney_left', 'kidney_right',
              'autochthon_left', 'autochthon_right', 'subcutaneous_fat', 'spinal_cord')}
    fluid, liver = parts['urinary_bladder'], parts['liver']
    muscle = next((parts[k] for k in ('autochthon_left', 'autochthon_right') if parts[k]), None)
    fat = parts['subcutaneous_fat']
    # Two independent reads, because not every study has a bladder in the field. Urine against liver
    # is the stronger of the two; spleen against liver is the one a reader uses at the console,
    # since the spleen outshines the liver on T2 and the liver outshines the spleen on T1.
    verdict, why, fluid_ratio, spleen_ratio = 'unclear', [], None, None
    if fluid and liver:
        fluid_ratio = fluid / liver
        why.append('T2' if fluid_ratio > 1.6 else 'T1' if fluid_ratio < 0.9 else 'intermediate')
    if parts['spleen'] and liver:
        spleen_ratio = parts['spleen'] / liver
        why.append('T2' if spleen_ratio > 1.35 else 'T1' if spleen_ratio < 1.1 else 'intermediate')
    if why and all(w == why[0] for w in why): verdict = why[0]
    elif 'T2' in why and 'T1' not in why: verdict = 'T2'
    elif 'T1' in why and 'T2' not in why: verdict = 'T1'
    elif why: verdict = 'conflicting'
    # Fat suppression is what separates STIR from T2, and muscle cannot show it because muscle is
    # dark on both. Subcutaneous fat can, and it needs no mask: it is the rim just inside the body
    # outline. Bright there means fat is present, dark means it was nulled.
    rim = subcutaneous(volume)
    if verdict in ('T2', 'intermediate') and rim is not None and liver and rim < liver * 1.5:
        verdict = 'STIR'
    return {'verdict': verdict, 'agreement': why,
            'subcutaneous/liver': None if rim is None or not liver else round(rim / liver, 2),
            'fluid/liver': None if fluid_ratio is None else round(fluid_ratio, 2),
            'spleen/liver': None if spleen_ratio is None else round(spleen_ratio, 2),
            'signals': {k: None if v is None else round(v) for k, v in parts.items()}}

if __name__ == '__main__':
    for directory in sys.argv[1:]:
        result = classify(directory)
        print(f"{os.path.basename(directory):8s} {result['verdict']:14s} agree={str(result['agreement']):22s} "
              f"fluid/liver={str(result['fluid/liver']):5s} spleen/liver={str(result['spleen/liver']):5s}")
